"use client";

/** Opens the browser's print dialog, where "Save as PDF" gives a copy to share. */
export function PrintButton() {
  return <button type="button" className="secondary" onClick={() => window.print()}>Print / save as PDF</button>;
}
