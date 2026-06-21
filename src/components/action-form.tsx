"use client";
import { useActionState } from "react";

export function ActionForm({ action, children, submitLabel }: { action: (state: { message?: string }, data: FormData) => Promise<{ message?: string }>; children: React.ReactNode; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="form">{children}{state.message && <p className="message">{state.message}</p>}<button disabled={pending}>{pending ? "Working…" : submitLabel}</button></form>;
}
