import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { logout } from "@/actions/auth";
import { currentUser, hasRole } from "@/lib/session";
import { AppNav, type NavItem } from "@/components/app-nav";

// Bundled with the app rather than fetched from Google at build or run time.
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", variable: "--font-inter", display: "swap", weight: "100 900" });

export const metadata: Metadata = {
  title: "RDC Learning",
  description: "Learning portal for RDC subsidiary companies",
  appleWebApp: { capable: true, title: "RDC Learning", statusBarStyle: "default" },
};

// Colours the phone's own status bar, and lets the page reach the screen's edges
// so the bottom tabs can sit above the home indicator.
export const viewport: Viewport = { themeColor: "#12233f", viewportFit: "cover" };

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
  if (user && hasRole(user, "LEARNER")) {
    navItems.push({ href: "/learn/courses", label: "My courses" });
    navItems.push({ href: "/learn/reels", label: "Reels" });
  }
  const signOut = <form action={logout}><button type="submit" className="signout">Sign out</button></form>;
  return <html lang="en" className={inter.variable}><body><div className={`shell${user ? " has-nav" : ""}`}>
    {user && <AppNav items={navItems} name={user.employee?.name ?? user.email} email={user.email} signOut={signOut} />}
    <div className="app-main">{children}</div>
  </div></body></html>;
}
