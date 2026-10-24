/**
 * A small, safe formatter for text lessons.
 *
 * Lessons the AI writes (and ones typed by hand) use a handful of markdown
 * marks: headings with #, bullet and numbered lists, **bold** and *italic*.
 * They are turned into blocks that the page renders as ordinary elements, so
 * whatever the text contains is shown as text and never run as markup.
 */
export type TextBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] };

export function parseLessonText(body: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let list: { kind: "bullets" | "numbers"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const number = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || number) {
      flushParagraph();
      const kind = bullet ? "bullets" : "numbers";
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] }; }
      list.items.push((bullet ?? number)![1].trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export type InlinePart = { text: string; bold?: boolean; italic?: boolean };

/** Splits one line of text on **bold** and *italic*; everything else is plain text. */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    if (match[1] !== undefined) parts.push({ text: match[1], bold: true });
    else parts.push({ text: match[2], italic: true });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text }];
}
