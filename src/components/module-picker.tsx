"use client";

import { useId, useState } from "react";

export type ModuleOption = {
  id: string;
  /** What the dropdown shows, e.g. "Module 2: Safety Protocols - awaiting approval". */
  label: string;
  panel: React.ReactNode;
};

/**
 * One module on screen at a time, chosen from a dropdown.
 *
 * The teacher's approval list stacked a full card per upload, and a course
 * with six modules ran to several screens before the rest of the page began.
 * Every panel stays mounted and is merely hidden, so a half-edited lesson
 * title survives switching to another module and back.
 */
export function ModulePicker({ legend, options, initialId }: { legend: string; options: ModuleOption[]; initialId?: string }) {
  const selectId = useId();
  const [active, setActive] = useState(initialId && options.some((option) => option.id === initialId) ? initialId : options[0]?.id);
  if (!options.length) return null;
  return <div className="module-picker">
    <label htmlFor={selectId}>{legend}
      <select id={selectId} value={active} onChange={(event) => setActive(event.target.value)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
    {options.map((option) => <div key={option.id} hidden={option.id !== active} role="region" aria-label={option.label}>{option.panel}</div>)}
  </div>;
}
