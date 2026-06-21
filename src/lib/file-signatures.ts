export function matchesFileSignature(extension: string, bytes: Uint8Array) {
  if (extension === ".pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (extension === ".ppt") return [0xd0, 0xcf, 0x11, 0xe0].every((value, index) => bytes[index] === value);
  if (extension === ".pptx") return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (extension === ".mp4") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  return false;
}
