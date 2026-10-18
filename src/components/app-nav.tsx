"use client";

import {
  BarChart3, BookOpen, ChevronsLeft, ChevronsRight, GraduationCap, LayoutDashboard, MoreHorizontal, Presentation, Users, X, type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { withBase } from "@/lib/base-path";

export type NavItem = { href: string; label: string };

const ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/reports": BarChart3,
  "/admin/employees": Users,
  "/admin/courses": BookOpen,
  "/teacher/courses": Presentation,
  "/learn/courses": GraduationCap,
};

/** Tabs shown along the bottom of a phone before the rest go behind "More". */
const TAB_LIMIT = 4;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

/**
 * Every piece of navigation the signed-in person sees.
 *
 * One list of links, drawn three ways: a sidebar on a laptop, a bar of tabs
 * along the bottom of a phone, and a "More" sheet for whatever does not fit
 * there plus the account and Sign out. Which of them shows is decided by CSS
 * (see the app shell rules in globals.css), so the server renders the same
 * thing for everyone and nothing flickers on load.
 *
 * "Dashboard" is /admin itself, so it is matched exactly; every other link
 * matches its whole section, so a course's own page still lights "Courses".
 *
 * `signOut` is the sign-out form, built on the server and handed in, so this
 * file stays presentation only.
 */
export function AppNav({ items, name, email, signOut }: { items: NavItem[]; name: string; email: string; signOut: ReactNode }) {
  const pathname = usePathname() || "/";
  // The sheet remembers the page it was opened on, so moving to another page
  // closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const sheetOpen = openAt === pathname;

  // A laptop can shrink the sidebar to icons to give wide tables more room. The
  // choice lives on <html> (CSS reads it from there) and is remembered.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem("lms-sidebar") === "collapsed"; } catch { /* storage blocked: stay expanded */ }
    if (saved) {
      document.documentElement.dataset.sidebar = "collapsed";
      // Reading storage is only possible after mount, so the first paint is expanded.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(true);
    }
  }, []);
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
    try { localStorage.setItem("lms-sidebar", next ? "collapsed" : "expanded"); } catch { /* not remembered */ }
  }

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
  const iconFor = (href: string) => ICONS[href] ?? BookOpen;

  const overflow = items.length > TAB_LIMIT;
  const tabs = overflow ? items.slice(0, TAB_LIMIT - 1) : items;
  const more = overflow ? items.slice(TAB_LIMIT - 1) : [];

  const brand = <Link className="brand" href="/dashboard">
    <Image src={withBase("/brand/rdc-logo.jpeg")} alt="RDC logo" width={72} height={44} />
    <span>RDC Learning</span>
  </Link>;

  return <>
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-top">
        {brand}
        <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? "Expand menu" : "Collapse menu"} title={collapsed ? "Expand menu" : "Collapse menu"}>
          {collapsed ? <ChevronsRight size={18} aria-hidden="true" /> : <ChevronsLeft size={18} aria-hidden="true" />}
        </button>
      </div>
      <nav className="side-nav">
        {items.map((item) => {
          const Icon = iconFor(item.href);
          const active = isActive(item.href);
          return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            <Icon size={20} aria-hidden="true" /><span className="nav-label">{item.label}</span>
          </Link>;
        })}
      </nav>
      <div className="side-user">
        <div className="avatar" aria-hidden="true">{initials(name)}</div>
        <div className="side-user-text"><strong>{name}</strong><span>{email}</span></div>
        {signOut}
      </div>
    </aside>

    <header className="mobile-bar">{brand}</header>

    <nav className="tabbar" aria-label="Main navigation">
      {tabs.map((item) => {
        const Icon = iconFor(item.href);
        const active = isActive(item.href);
        return <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
          <Icon size={22} aria-hidden="true" /><span>{item.label}</span>
        </Link>;
      })}
      <button type="button" className={`tab-more${sheetOpen || more.some((item) => isActive(item.href)) ? " active" : ""}`} aria-expanded={sheetOpen} onClick={() => setOpenAt(pathname)}>
        <MoreHorizontal size={22} aria-hidden="true" /><span>More</span>
      </button>
    </nav>

    {sheetOpen && <div className="sheet-backdrop" onClick={() => setOpenAt(null)}>
      <div className="sheet" role="dialog" aria-label="More" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <div className="avatar" aria-hidden="true">{initials(name)}</div>
          <div className="side-user-text"><strong>{name}</strong><span>{email}</span></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => setOpenAt(null)}><X size={20} aria-hidden="true" /></button>
        </div>
        {more.length > 0 && <nav className="sheet-links">
          {more.map((item) => {
            const Icon = iconFor(item.href);
            return <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : undefined}><Icon size={20} aria-hidden="true" />{item.label}</Link>;
          })}
        </nav>}
        <div className="sheet-signout">{signOut}</div>
      </div>
    </div>}
  </>;
}
