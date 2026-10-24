"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetScormForLearner } from "@/actions/scorm";

export function ScormResetButton({ enrollmentId, lessonId, name, passed }: { enrollmentId: string; lessonId: string; name: string; passed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  function reset() {
    const warning = passed
      ? `${name} has already passed. Resetting removes the pass and they will have to take the course again. Reset?`
      : `Give ${name} two new attempts?`;
    if (!window.confirm(warning)) return;
    startTransition(async () => { await resetScormForLearner(enrollmentId, lessonId); setDone(true); router.refresh(); });
  }
  return <button type="button" className="secondary" disabled={pending || done} onClick={reset}>{done ? "Reset" : pending ? "Resetting…" : "Reset attempts"}</button>;
}
