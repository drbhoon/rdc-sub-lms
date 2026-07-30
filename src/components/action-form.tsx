"use client";

import { useActionState } from "react";

export function ActionForm({ action, children, submitLabel, buttonClassName }: {
  action: (state: { message?: string }, data: FormData) => Promise<{ message?: string }>;
  children: React.ReactNode;
  submitLabel: string;
  buttonClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="form">
    {children}
    {state.message && <p className="message">{state.message}</p>}
    <button className={buttonClassName} disabled={pending}>{pending ? "Working..." : submitLabel}</button>
  </form>;
}
