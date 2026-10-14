"use client";

import { useState, type ReactNode } from "react";

/**
 * The "Inactive Courses" tab above a course list. Inactive courses are kept out
 * of the list; clicking the tab shows them, clicking it again hides them. The
 * cards are built on the server and passed in, so this only decides whether to
 * show them.
 */
export function InactiveCourses({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return <>
    <div className="report-tabs">
      <button type="button" className={`tab-button${open ? " active" : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Inactive Courses ({count})
      </button>
    </div>
    {open && <div className="grid">{children}</div>}
  </>;
}
