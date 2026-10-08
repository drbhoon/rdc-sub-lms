"use client";

import { allowFinalAttempt } from "@/actions/final-schedule";

/**
 * One learner's "allow another attempt". It cannot be taken back, so it asks
 * first; a plain form with a confirm keeps it working with no other state.
 */
export function AllowAttemptButton({ enrollmentId, learner, label }: { enrollmentId: string; learner: string; label: string }) {
  return <form
    action={allowFinalAttempt}
    onSubmit={(event) => {
      if (!window.confirm(`${label} for ${learner}? They will be able to start the final assessment straight away, whatever their class's schedule says.`)) event.preventDefault();
    }}
  >
    <input type="hidden" name="enrollmentId" value={enrollmentId} />
    <button className="secondary">{label}</button>
  </form>;
}
