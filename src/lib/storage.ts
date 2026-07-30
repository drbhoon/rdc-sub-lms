import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export interface StorageProvider {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
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
}

export const storage: StorageProvider = new LocalStorage();
