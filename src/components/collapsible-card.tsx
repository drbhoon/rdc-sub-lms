"use client";

import { useState } from "react";

/**
 * A card whose heading folds it open and shut.
 *
 * Built on the browser's own <details>/<summary>, so it works from the
 * keyboard, is announced as expandable by screen readers, and needs no
 * scripting to be usable. The open state is kept here only so a re-render after
 * a server action (answering a question, saving a score) cannot snap it shut
 * under the teacher: a plain `open={...}` prop would be re-applied each time.
 *
 * `summary` is the short line shown beside the heading while it is folded, so a
 * closed card still says what is in it ("3 unanswered", "24 learners").
 */
export function CollapsibleCard({ title, summary, defaultOpen = false, id, className, children }: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <details
    className={`card collapsible${className ? ` ${className}` : ""}`}
    id={id}
    open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}
  >
    <summary>
      <h2>{title}</h2>
      {summary && <span className="collapsible-summary muted">{summary}</span>}
    </summary>
    <div className="collapsible-body">{children}</div>
  </details>;
}
