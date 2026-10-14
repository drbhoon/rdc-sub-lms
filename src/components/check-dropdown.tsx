"use client";

import { useMemo, useState } from "react";

export type CheckOption = { value: string; label: string; group?: string };

/**
 * A dropdown that holds a list of tick boxes, so any number of choices can be
 * made from one compact control. It sits inside an ordinary GET form: the
 * ticked boxes are plain checkboxes named `name`, so submitting needs no
 * scripting. The script only adds the count on the button, a search box for
 * long lists, and All / None.
 */
export function CheckDropdown({ name, label, options, selected, emptyMeans = "Any" }: {
  name: string;
  label: string;
  options: CheckOption[];
  selected: string[];
  /** What the button says when nothing is ticked ("Any" for filters). */
  emptyMeans?: string;
}) {
  const [chosen, setChosen] = useState(() => new Set(selected));
  const [term, setTerm] = useState("");
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, term]);

  function toggle(value: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }
  function setAll(values: string[], on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      for (const value of values) {
        if (on) next.add(value);
        else next.delete(value);
      }
      return next;
    });
  }

  const summary = chosen.size === 0
    ? emptyMeans
    : chosen.size === 1 ? options.find((option) => chosen.has(option.value))?.label ?? "1 selected" : `${chosen.size} selected`;
  const shownValues = new Set(shown.map((option) => option.value));

  return <div className="check-dropdown">
    <span className="check-dropdown-label">{label}</span>
    <details>
      <summary><span className="check-dropdown-value">{summary}</span></summary>
      <div className="check-dropdown-panel">
        {options.length > 8 && <input type="search" placeholder={`Search ${label.toLowerCase()}`} value={term} onChange={(event) => setTerm(event.target.value)} aria-label={`Search ${label}`} />}
        <div className="check-dropdown-actions">
          <button type="button" className="secondary" onClick={() => setAll(shown.map((option) => option.value), true)}>All{term ? " shown" : ""}</button>
          <button type="button" className="secondary" onClick={() => setAll(shown.map((option) => option.value), false)}>None{term ? " shown" : ""}</button>
        </div>
        <div className="check-dropdown-list">
          {shown.map((option, index) => {
            const heading = option.group && option.group !== shown[index - 1]?.group ? <strong className="check-dropdown-group">{option.group}</strong> : null;
            return <div key={option.value}>
              {heading}
              <label className="checkbox"><input type="checkbox" name={name} value={option.value} checked={chosen.has(option.value)} onChange={() => toggle(option.value)} />{option.label}</label>
            </div>;
          })}
          {!shown.length && <p className="muted">Nothing matches.</p>}
        </div>
        {/* A search hides boxes, not choices: what is ticked but hidden is still submitted. */}
        {options.filter((option) => chosen.has(option.value) && !shownValues.has(option.value)).map((option) => <input key={option.value} type="hidden" name={name} value={option.value} />)}
      </div>
    </details>
  </div>;
}
