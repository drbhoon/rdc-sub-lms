"use client";

import { useState } from "react";

export type VersionOption = { value: string; label: string; live: boolean };

/**
 * A version dropdown that shows which version is live, in green: the live ones
 * are marked and coloured in the list, and the box itself turns green while a
 * live version is the one chosen. A plain <select> inside the report's GET
 * form, so choosing and applying work exactly as before.
 */
export function LiveVersionSelect({ name, options, defaultValue }: { name: string; options: VersionOption[]; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const chosenIsLive = options.find((option) => option.value === value)?.live ?? false;
  return <>
    <select name={name} value={value} onChange={(event) => setValue(event.target.value)} className={chosenIsLive ? "select-live" : undefined}>
      {options.map((option) => <option key={option.value} value={option.value} className={option.live ? "option-live" : undefined}>
        {option.live ? "● LIVE · " : ""}{option.label}
      </option>)}
    </select>
    {options.some((option) => option.live) && <small className="live-legend">Green is the live version.</small>}
  </>;
}
