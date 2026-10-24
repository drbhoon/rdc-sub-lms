import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import unzipper from "unzipper";
import { parseScormManifest, ScormManifestError, type ScormManifest } from "./scorm-manifest";

/**
 * Unpacking an uploaded SCORM zip into storage, safely.
 *
 * What it guards against: a zip entry named "../../something" that would land
 * outside the package folder, absurdly large or numerous files, and the very
 * common mistake of uploading the vendor's whole delivery bundle instead of the
 * package inside it (Articulate hands over a zip that contains SCORM_Package.zip
 * beside the editable source). The nested package is found and used.
 */
export const MAX_SCORM_FILES = 20_000;
export const MAX_SCORM_BYTES = 1024 * 1024 * 1024;

type Sink = { put(key: string, bytes: Uint8Array): Promise<void> };

/** A safe relative path for a zip entry, or null if it must not be extracted. */
export function safeEntryPath(entry: string): string | null {
  const normalised = entry.replace(/\\/g, "/");
  if (!normalised || normalised.endsWith("/") || normalised.includes("\0")) return null;
  if (normalised.startsWith("/") || /^[a-zA-Z]:/.test(normalised)) return null;
  const parts = normalised.split("/");
  if (parts.some((part) => part === ".." || part === "")) return null;
  return parts.filter((part) => part !== ".").join("/");
}

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/i;

export type UnpackedPackage = { manifest: ScormManifest; files: number; bytes: number; unwrapped: boolean };

export async function unpackScormZip(zipPath: string, destination: string, sink: Sink, nested = false): Promise<UnpackedPackage> {
  const directory = await unzipper.Open.file(zipPath);
  const entries = directory.files.filter((entry) => entry.type === "File");

  const findManifest = () => entries
    .filter((entry) => /(^|\/)imsmanifest\.xml$/i.test(entry.path.replace(/\\/g, "/")) && !JUNK.test(entry.path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  const manifestEntry = findManifest();

  if (!manifestEntry) {
    // The vendor's whole delivery: the real package sits inside it.
    const inner = entries.find((entry) => /(^|\/)SCORM_Package\.zip$/i.test(entry.path.replace(/\\/g, "/")));
    if (inner && !nested) {
      const temp = await mkdtemp(path.join(os.tmpdir(), "rdc-scorm-inner-"));
      try {
        const innerPath = path.join(temp, "package.zip");
        await writeFile(innerPath, await inner.buffer());
        const result = await unpackScormZip(innerPath, destination, sink, true);
        return { ...result, unwrapped: true };
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    throw new ScormManifestError("This zip is not a SCORM package: it has no imsmanifest.xml. Upload the package your authoring tool exports for an LMS (for Articulate, the SCORM_Package.zip).");
  }

  const manifestPath = manifestEntry.path.replace(/\\/g, "/");
  const prefix = manifestPath.slice(0, manifestPath.length - "imsmanifest.xml".length);
  const manifest = parseScormManifest((await manifestEntry.buffer()).toString("utf8"));

  const wanted = entries
    .map((entry) => ({ entry, name: entry.path.replace(/\\/g, "/") }))
    .filter(({ name }) => name.startsWith(prefix) && !JUNK.test(name))
    .map(({ entry, name }) => ({ entry, relative: safeEntryPath(name.slice(prefix.length)) }));
  if (wanted.some(({ relative }) => relative === null)) {
    throw new ScormManifestError("This package contains files with unsafe paths and was refused.");
  }
  if (wanted.length > MAX_SCORM_FILES) throw new ScormManifestError(`This package has more than ${MAX_SCORM_FILES} files.`);
  const total = wanted.reduce((sum, { entry }) => sum + (entry.uncompressedSize ?? 0), 0);
  if (total > MAX_SCORM_BYTES) throw new ScormManifestError(`This package is larger than ${Math.round(MAX_SCORM_BYTES / 1048576)} MB once unpacked.`);

  const launchFile = manifest.launchPath.split(/[?#]/)[0];
  if (!wanted.some(({ relative }) => relative === safeEntryPath(launchFile))) {
    throw new ScormManifestError(`The package says to start at "${launchFile}", but that file is not in it.`);
  }

  // A handful at a time: the package is hundreds of small files.
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const { entry, relative } = wanted[next++];
      await sink.put(`${destination}/${relative}`, await entry.buffer());
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { manifest, files: wanted.length, bytes: total, unwrapped: false };
}
