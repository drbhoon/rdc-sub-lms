import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { logout } from "@/actions/auth";
import { currentUser, hasRole } from "@/lib/session";
import { withBase } from "@/lib/base-path";
import { NavLinks, type NavItem } from "@/components/nav-links";

export const metadata: Metadata = { title: "RDC Learning", description: "Learning portal for RDC subsidiary companies" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  const navItems: NavItem[] = [];
  if (user && hasRole(user, "SUPER_ADMIN")) {
    navItems.push(
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/reports", label: "Reports" },
      { href: "/admin/employees", label: "Employees" },
      { href: "/admin/courses", label: "Courses" },
    );
  }
  if (user && hasRole(user, "TEACHER")) navItems.push({ href: "/teacher/courses", label: "Teacher" });
  if (user && hasRole(user, "LEARNER")) navItems.push({ href: "/learn/courses", label: "My courses" });
  return <html lang="en"><body><div className="shell">
    {user && <header className="topbar"><Link className="brand" href="/dashboard"><Image src={withBase("/brand/rdc-logo.jpeg")} alt="RDC logo" width={72} height={44} /> <span>RDC Learning</span></Link><nav className="nav">
      <NavLinks items={navItems} />
      <form action={logout}><button type="submit">Sign out</button></form>
    </nav></header>}
    {children}
  </div></body></html>;
}
