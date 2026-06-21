import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { logout } from "@/actions/auth";
import { currentUser, hasRole } from "@/lib/session";

export const metadata: Metadata = { title: "RDC Learning", description: "Learning portal for RDC subsidiary companies" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  return <html lang="en"><body><div className="shell">
    {user && <header className="topbar"><Link className="brand" href="/dashboard">RDC Learning</Link><nav className="nav">
      {hasRole(user, "SUPER_ADMIN") && <><Link href="/admin">Dashboard</Link><Link href="/admin/employees">Employees</Link><Link href="/admin/courses">Courses</Link></>}
      {hasRole(user, "TEACHER") && <Link href="/teacher/courses">Teaching</Link>}
      {hasRole(user, "LEARNER") && <Link href="/learn/courses">My courses</Link>}
      <form action={logout}><button type="submit">Sign out</button></form>
    </nav></header>}
    {children}
  </div></body></html>;
}
