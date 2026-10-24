import { parseInline, parseLessonText } from "@/lib/lesson-text";

function Inline({ text }: { text: string }) {
  return <>{parseInline(text).map((part, index) => part.bold
    ? <strong key={index}>{part.text}</strong>
    : part.italic ? <em key={index}>{part.text}</em> : <span key={index}>{part.text}</span>)}</>;
}

/** A text lesson, drawn from its light markdown as ordinary headings, paragraphs and lists. */
export function LessonText({ body }: { body: string }) {
  const blocks = parseLessonText(body);
  if (!blocks.length) return <p className="muted">This lesson has no text yet.</p>;
  return <div className="lesson-text">
    {blocks.map((block, index) => {
      if (block.kind === "heading") {
        const Tag = (`h${block.level + 1}`) as "h2" | "h3" | "h4";
        return <Tag key={index}><Inline text={block.text} /></Tag>;
      }
      if (block.kind === "paragraph") return <p key={index}><Inline text={block.text} /></p>;
      const Tag = block.kind === "bullets" ? "ul" : "ol";
      return <Tag key={index}>{block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</Tag>;
    })}
  </div>;
}
