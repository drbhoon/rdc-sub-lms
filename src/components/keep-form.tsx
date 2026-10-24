"use client";

import { useRef, useState, useTransition } from "react";

type Result = { message?: string; ok?: boolean };

/**
 * A form whose typing survives a mistake. React clears a form after every
 * submit it handles as an action, even a refused one, which would wipe a whole
 * session's details because of one mistyped link. This sends the form itself
 * and clears it only when the server says it worked.
 */
export function KeepForm({ action, submitLabel, clearOnSuccess = false, children }: {
  action: (state: Result, data: FormData) => Promise<Result>;
  submitLabel: string;
  clearOnSuccess?: boolean;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<Result>({});
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = await action({}, data);
      setResult(next);
      if (next.ok && clearOnSuccess) form.current?.reset();
    });
  }

  return <form ref={form} onSubmit={submit} className="form">
    {children}
    {result.message && <p className={result.ok ? "message success" : "message"} role="status">{result.message}</p>}
    <button disabled={pending}>{pending ? "Working..." : submitLabel}</button>
  </form>;
}
