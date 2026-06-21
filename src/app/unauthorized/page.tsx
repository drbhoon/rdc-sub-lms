import Link from "next/link";
export default function Unauthorized() { return <main className="narrow card"><h1>Access denied</h1><p>Your account does not have access to this area.</p><Link className="button" href="/dashboard">Return to dashboard</Link></main>; }
