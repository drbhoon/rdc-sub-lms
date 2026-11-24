export function jsonText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

export function buildCourseAiSource(contents: Array<{
  originalName: string;
  extractedText: string | null;
  summary: string | null;
  keyPoints: unknown;
  glossary: unknown;
  /** For reference material tied to a video module: that module, so the AI knows what the file is about. */
  referenceFor?: { originalName: string } | null;
}>) {
  return contents.map((content) => [
    content.referenceFor ? `REFERENCE MATERIAL for the video module "${content.referenceFor.originalName}": ${content.originalName}` : `CONTENT: ${content.originalName}`,
    content.summary ? `Summary: ${content.summary}` : "",
    jsonText(content.keyPoints) ? `Key points:\n${jsonText(content.keyPoints)}` : "",
    jsonText(content.glossary) ? `Glossary:\n${jsonText(content.glossary)}` : "",
    content.extractedText ? `Source text:\n${content.extractedText}` : "",
  ].filter(Boolean).join("\n\n")).join("\n\n---\n\n").replace(/\s+/g, " ").trim();
}
