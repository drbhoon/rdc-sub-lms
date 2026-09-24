"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

/**
 * The top navigation, with the section you are in marked.
 *
 * The layout is a server component and cannot see the current path, so the
 * links used to render identically on every page — nothing told you which
 * section you were looking at. This is the only part of the header that needs
 * the browser.
 *
 * "Dashboard" is /admin itself, so it is matched exactly; everything else
 * matches its whole section, so a course's own page still lights "Courses".
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname() || "/";
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "nav-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
