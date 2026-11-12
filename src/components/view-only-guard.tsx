"use client";

import { useEffect } from "react";

/**
 * While an administrator is looking at a learner's account, every form that
 * would save something is switched off (greyed out by CSS, and made inert here
 * so the keyboard cannot reach it either). The server refuses the writes
 * regardless (lib/db.ts); this only stops the attempt from ending in an error
 * page. Forms that only search (GET) are left alone.
 */
export function ViewOnlyGuard() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLFormElement>(".app-main form").forEach((form) => {
        if ((form.getAttribute("method") ?? "").toLowerCase() !== "get") form.inert = true;
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.querySelector(".app-main") ?? document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
