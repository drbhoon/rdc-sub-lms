import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export interface StorageProvider {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
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
}

export const storage: StorageProvider = new LocalStorage();
