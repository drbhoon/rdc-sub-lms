"use client";
import { useActionState, useState } from "react";
import { requestOtp, verifyOtp } from "@/actions/auth";

export function AuthForm() {
  const [email, setEmail] = useState("");
  const [requestState, requestAction, requesting] = useActionState(requestOtp, {});
  const [verifyState, verifyAction, verifying] = useActionState(verifyOtp, {});
  const codeRequested = Boolean(requestState.ok);
  return <div className="card"><h1>Sign in</h1><p className="muted">Use the email address registered in the employee master.</p>
    {!codeRequested ? <form action={requestAction} className="form"><label>Email address<input name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {requestState.message && <p className="message">{requestState.message}</p>}<button disabled={requesting}>{requesting ? "Sending…" : "Send login code"}</button></form>
    : <form action={verifyAction} className="form"><input type="hidden" name="email" value={requestState.email ?? email} /><p className="message">{requestState.message}</p>
      <label>Six-digit login code<input name="otp" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required /></label>
      {verifyState.message && <p className="message error">{verifyState.message}</p>}<button disabled={verifying}>{verifying ? "Checking…" : "Sign in"}</button></form>}
  </div>;
}
