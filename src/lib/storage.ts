import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "@/lib/env";

export interface StorageProvider {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Size in bytes, or null when there is no such object. */
  size(key: string): Promise<number | null>;
  /** Add bytes to the end of an object, creating it if needed. Used to assemble a chunked upload. */
  append(key: string, bytes: Uint8Array): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** The object, or an inclusive byte range of it, as a web stream — for video, which is too big to buffer and must support seeking. */
  stream(key: string, range?: { start: number; end: number }): ReadableStream<Uint8Array>;
  /** Keys under a prefix, with when each was last written. */
  list(prefix: string): Promise<{ key: string; modifiedAt: Date }[]>;
}

class LocalStorage implements StorageProvider {
  private root = path.resolve(env.STORAGE_ROOT);
  private resolve(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Invalid storage key");
    return target;
  }
  async put(key: string, bytes: Uint8Array) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  get(key: string) { return readFile(this.resolve(key)); }
  delete(key: string) { return rm(this.resolve(key), { force: true }); }
  async size(key: string) {
    try { return (await stat(this.resolve(key))).size; } catch { return null; }
  }
  async append(key: string, bytes: Uint8Array) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, bytes);
  }
  async move(from: string, to: string) {
    const target = this.resolve(to);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(this.resolve(from), target);
  }
  stream(key: string, range?: { start: number; end: number }) {
    return Readable.toWeb(createReadStream(this.resolve(key), range)) as ReadableStream<Uint8Array>;
  }
  async list(prefix: string) {
    const dir = this.resolve(prefix);
    const names = await readdir(dir).catch(() => [] as string[]);
    return Promise.all(names.map(async (name) => ({ key: `${prefix}/${name}`, modifiedAt: (await stat(path.join(dir, name))).mtime })));
  }
}

export const storage: StorageProvider = new LocalStorage();
