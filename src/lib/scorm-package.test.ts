import JSZip from "jszip";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { safeEntryPath, unpackScormZip } from "./scorm-package";
import { ScormManifestError } from "./scorm-manifest";

const MANIFEST = `<?xml version="1.0"?>
<manifest identifier="m" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
<metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
<organizations default="o"><organization identifier="o"><title>Mini</title><item identifier="i" identifierref="r"><title>Mini</title></item></organization></organizations>
<resources><resource identifier="r" type="webcontent" adlcp:scormtype="sco" href="index.html"/></resources></manifest>`;

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function makeZip(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scorm-test-"));
  cleanup.push(dir);
  const file = path.join(dir, "package.zip");
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}

function memorySink() {
  const stored = new Map<string, string>();
  return { stored, put: async (key: string, bytes: Uint8Array) => { stored.set(key, Buffer.from(bytes).toString()); } };
}

describe("safeEntryPath", () => {
  it("keeps ordinary relative paths", () => {
    expect(safeEntryPath("story_content/video.mp4")).toBe("story_content/video.mp4");
    expect(safeEntryPath("./a/./b.js")).toBe("a/b.js");
    expect(safeEntryPath("a\\b\\c.js")).toBe("a/b/c.js");
  });
  it("refuses anything that could leave the folder", () => {
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/Windows/x", "a//b", "dir/", "", "a\0b"]) {
      expect(safeEntryPath(bad), bad).toBeNull();
    }
  });
});

describe("unpackScormZip", () => {
  it("unpacks a package whose manifest is at the root", async () => {
    const zip = await makeZip({ "imsmanifest.xml": MANIFEST, "index.html": "<html>hi</html>", "lms/API.js": "x" });
    const sink = memorySink();
    const result = await unpackScormZip(zip, "scorm/c1", sink);
    expect(result.manifest.version).toBe("1.2");
    expect(result.unwrapped).toBe(false);
    expect([...sink.stored.keys()].sort()).toEqual(["scorm/c1/imsmanifest.xml", "scorm/c1/index.html", "scorm/c1/lms/API.js"]);
  });
  it("finds a manifest inside a single wrapping folder and strips the folder", async () => {
    const zip = await makeZip({ "pkg/imsmanifest.xml": MANIFEST, "pkg/index.html": "x" });
    const sink = memorySink();
    await unpackScormZip(zip, "scorm/c2", sink);
    expect([...sink.stored.keys()].sort()).toEqual(["scorm/c2/imsmanifest.xml", "scorm/c2/index.html"]);
  });
  it("uses the package inside a vendor delivery bundle", async () => {
    const inner = await makeZip({ "imsmanifest.xml": MANIFEST, "index.html": "inner" });
    const { readFile } = await import("node:fs/promises");
    const bundle = await makeZip({ "SCORM_Package.zip": await readFile(inner), "Launch Course.html": "<html/>", "Course.story": "source" });
    const sink = memorySink();
    const result = await unpackScormZip(bundle, "scorm/c3", sink);
    expect(result.unwrapped).toBe(true);
    expect(sink.stored.get("scorm/c3/index.html")).toBe("inner");
    expect(sink.stored.has("scorm/c3/Course.story")).toBe(false);
  });
  it("skips macOS junk", async () => {
    const zip = await makeZip({ "imsmanifest.xml": MANIFEST, "index.html": "x", "__MACOSX/._index.html": "junk", ".DS_Store": "junk" });
    const sink = memorySink();
    await unpackScormZip(zip, "scorm/c4", sink);
    expect([...sink.stored.keys()].sort()).toEqual(["scorm/c4/imsmanifest.xml", "scorm/c4/index.html"]);
  });
  it("refuses a zip with no manifest", async () => {
    const zip = await makeZip({ "readme.txt": "not scorm" });
    await expect(unpackScormZip(zip, "scorm/x", memorySink())).rejects.toThrow(/no imsmanifest\.xml/);
  });
  it("refuses a package whose launch file is missing", async () => {
    const zip = await makeZip({ "imsmanifest.xml": MANIFEST });
    await expect(unpackScormZip(zip, "scorm/x", memorySink())).rejects.toThrow(/index\.html/);
  });
  it("refuses a package that tries to write outside its folder", async () => {
    const zip = await makeZip({ "imsmanifest.xml": MANIFEST, "index.html": "x", "../evil.js": "boom" });
    const sink = memorySink();
    await expect(unpackScormZip(zip, "scorm/x", sink)).rejects.toThrow(ScormManifestError);
    expect(sink.stored.size).toBe(0);
  });
});
