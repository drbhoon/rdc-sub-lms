import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The banner at the top of an admin page: deep blue, with the page's title, a
 * line about what it is for, and (on the right) whatever the page needs most
 * within reach, such as its period filter or a download button. The same look
 * as the course covers and the learner's Continue learning card, so the admin
 * screens read as part of one app.
 */
export function AdminHero({ icon: Icon, title, subtitle, children }: { icon: LucideIcon; title: string; subtitle?: string; children?: ReactNode }) {
  return <section className="admin-hero">
    <div className="admin-hero-text">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children && <div className="admin-hero-actions">{children}</div>}
    <Icon className="admin-hero-icon" size={170} strokeWidth={1.2} aria-hidden="true" />
  </section>;
}

export type Tone = "blue" | "teal" | "purple" | "amber";
const TONES: Tone[] = ["blue", "teal", "purple", "amber"];
/** Tones in turn, so a row of tiles gets the same colours as a row of course covers. */
export const toneAt = (index: number): Tone => TONES[index % TONES.length];

/** A headline number on a coloured tile. With `href`, the whole tile is a link. */
export function StatTile({ icon: Icon, value, label, tone, href }: { icon: LucideIcon; value: ReactNode; label: string; tone: Tone; href?: string }) {
  const body = <>
    <Icon className="stat-bg" size={96} strokeWidth={1.4} aria-hidden="true" />
    <Icon className="stat-icon" size={22} aria-hidden="true" />
    <strong>{value}</strong>
    <span>{label}</span>
  </>;
  return href
    ? <Link className={`stat-tile tone-${tone}`} href={href}>{body}</Link>
    : <div className={`stat-tile tone-${tone}`}>{body}</div>;
}
