/** Content types for the files inside an unpacked SCORM package. Browsers refuse scripts and styles served as the wrong type. */
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", xhtml: "application/xhtml+xml; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf", wasm: "application/wasm", vtt: "text/vtt; charset=utf-8", swf: "application/x-shockwave-flash",
};

export function scormMime(filePath: string): string {
  const extension = filePath.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return TYPES[extension] ?? "application/octet-stream";
}
