"use client";

import { useActionState, useEffect, useState } from "react";

const SELECTOR = 'input[name="employeeIds"][form="bulk-archive"]';

/**
 * The bar above the Employees table for moving many people to the Archive at
 * once. The tick boxes live in the table rows and belong to this form through
 * their form attribute, which keeps the table's own per-row forms from being
 * nested inside this one.
 */
export function BulkArchive({ action, eligible, canRun }: {
  action: (state: { message?: string }, data: FormData) => Promise<{ message?: string }>;
  /** How many rows on this page can be ticked. */
  eligible: number;
  /** False until a sync has run: nobody is known to be "not in master" before that. */
  canRun: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [count, setCount] = useState(0);

  useEffect(() => {
    const recount = () => setCount(document.querySelectorAll<HTMLInputElement>(`${SELECTOR}:checked`).length);
    document.addEventListener("change", recount);
    return () => document.removeEventListener("change", recount);
  }, []);

  function setAll(checked: boolean) {
    document.querySelectorAll<HTMLInputElement>(SELECTOR).forEach((box) => { box.checked = checked; });
    setCount(checked ? document.querySelectorAll(SELECTOR).length : 0);
  }

  return <form id="bulk-archive" className="bulk-bar" action={formAction}
    onSubmit={(event) => {
      if (!window.confirm(`Move ${count} ${count === 1 ? "person" : "people"} to the Archive? They will not be able to sign in. Nothing is deleted and you can restore anyone.`)) event.preventDefault();
    }}>
    <div className="button-row">
      <button type="button" className="secondary" disabled={!eligible || !canRun} onClick={() => setAll(true)}>Select all {eligible} shown</button>
      <button type="button" className="secondary" disabled={!count} onClick={() => setAll(false)}>Clear</button>
      <button type="submit" className="danger" disabled={!count || pending || !canRun}>{pending ? "Archiving…" : `Archive ${count} selected`}</button>
    </div>
    {!canRun && <p className="muted">Run “Sync Employee Data with Master” first, so it is known who is in the master.</p>}
    {state.message && <p className="message" role="status">{state.message}</p>}
  </form>;
}
