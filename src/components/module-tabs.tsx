"use client";

import { useState } from "react";
import { CollapsibleCard } from "@/components/collapsible-card";

export type ModuleTab = {
  id: string;
  label: string;
  /** Shown beside the label: "done" = nothing left to do in this module, "todo" = something is. */
  status?: "done" | "todo";
  panel: React.ReactNode;
};

/**
 * One tab per module, with only the chosen module's quiz and feedback on
 * screen. Stacking every module's cards made the page run on for screens
 * once a course had more than two or three modules.
 *
 * Every panel stays mounted and is merely hidden, so switching tabs does not
 * lose answers half-typed into a feedback form.
 */
export function ModuleTabs({ title, intro, actions, tabs, initialId, collapsible = false }: {
  title: string; intro?: string; actions?: React.ReactNode; tabs: ModuleTab[]; initialId?: string;
  /** Fold the whole card under its heading, closed to begin with. */
  collapsible?: boolean;
}) {
  const [active, setActive] = useState(initialId && tabs.some((tab) => tab.id === initialId) ? initialId : tabs[0]?.id);
  if (!tabs.length) return null;
  const body = <>
    {intro && <p className="muted">{intro}</p>}
    {actions}
    <div className="module-tab-list" role="tablist">
      {tabs.map((tab) => <button
        key={tab.id}
        type="button"
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={tab.id === active}
        aria-controls={`panel-${tab.id}`}
        className={`module-tab${tab.id === active ? " module-tab-active" : ""}`}
        onClick={() => setActive(tab.id)}
      >
        {tab.label}
        {tab.status === "done" && <span className="module-tab-status" aria-label="done"> ✓</span>}
        {tab.status === "todo" && <span className="module-tab-status module-tab-todo" aria-label="to do"> ●</span>}
      </button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={tab.id !== active} className="module-tab-panel">
      {/* Names the module again inside the panel, so what is on screen is never in doubt. */}
      <h3 className="module-tab-heading">{tab.label}</h3>
      {tab.panel}
    </div>)}
  </>;
  if (collapsible) return <CollapsibleCard title={title} summary={`${tabs.length} tab${tabs.length === 1 ? "" : "s"}`} className="module-tabs">{body}</CollapsibleCard>;
  return <section className="card module-tabs">
    <h2>{title}</h2>
    {body}
  </section>;
}
