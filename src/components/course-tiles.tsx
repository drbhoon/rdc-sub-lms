"use client";

import Link from "next/link";
import { useState } from "react";
import { ProgressRing } from "@/components/progress-ring";

export type CourseTile = {
  id: string;
  title: string;
  category: string;
  minutes: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  percent: number;
  inactive: boolean;
};

type Filter = "ALL" | CourseTile["status"];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "NOT_STARTED", label: "Not started" },
  { key: "COMPLETED", label: "Completed" },
];

const STATUS_TEXT: Record<CourseTile["status"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

/** Four brand-toned cover colours, picked from the title so a course always gets the same one. */
const COVERS = ["#1f3a8a", "#0f766e", "#7c3aed", "#b45309"];
const coverFor = (title: string) => COVERS[[...title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COVERS.length];

/**
 * The learner's courses as tiles, with chips to narrow them by status. The
 * chips only choose what to show; every tile still opens its course.
 */
export function CourseTiles({ tiles }: { tiles: CourseTile[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const count = (key: Filter) => (key === "ALL" ? tiles.length : tiles.filter((tile) => tile.status === key).length);
  const shown = filter === "ALL" ? tiles : tiles.filter((tile) => tile.status === filter);

  return <>
    <div className="chips" role="group" aria-label="Filter courses">
      {FILTERS.filter((item) => item.key === "ALL" || count(item.key) > 0).map((item) =>
        <button key={item.key} type="button" className={`chip${filter === item.key ? " chip-active" : ""}`} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
          {item.label} <span>{count(item.key)}</span>
        </button>)}
    </div>
    <div className="tile-grid">
      {shown.map((tile) => <Link key={tile.id} href={`/learn/courses/${tile.id}`} className={`course-tile${tile.inactive ? " inactive-card" : ""}`}>
        <div className="tile-cover" style={{ background: coverFor(tile.title) }}>
          <span className="tile-category">{tile.category}</span>
          <span className="tile-initial" aria-hidden="true">{tile.title.charAt(0).toUpperCase()}</span>
        </div>
        <div className="tile-body">
          <h3>{tile.title}</h3>
          <p className="muted">{tile.minutes} minutes{tile.inactive ? " · Inactive" : ""}</p>
          <div className="tile-foot">
            <span className={`status-pill status-${tile.status.toLowerCase()}`}>{STATUS_TEXT[tile.status]}</span>
            <ProgressRing percent={tile.percent} size={44} stroke={5} />
          </div>
        </div>
      </Link>)}
      {!shown.length && <p className="muted">No courses here yet.</p>}
    </div>
  </>;
}
