/**
 * Client for the portal's identity resolver.
 *
 * LMS differs from the other apps on the platform. PARAKH, SRT and techno are
 * roll-bound and refuse anyone not on the employee master; LMS deliberately
 * serves off-roll staff and third-party learners who may never appear there.
 *
 * So this resolution is SOFT in two ways:
 *
 *   1. It does not require an internal person. An unrecognised learner becomes
 *      an EXTERNAL person rather than a refusal — they are still a real human
 *      whose course record should be findable.
 *   2. It never blocks. If the portal is unreachable the employee is created
 *      anyway with no person id; a backfill picks them up later. Refusing to
 *      enrol somebody because a different container was slow would be absurd.
 *
 * The pay-off comes when the off-roll feed arrives: because the portal matches
 * on e-mail before deciding anybody is new, a learner created here as external
 * is the SAME person the feed later attaches an employee code to — not a
 * duplicate.
 */
const MASTER_API_URL = (process.env.MASTER_API_URL || "").replace(/\/$/, "");
const MASTER_API_KEY = process.env.MASTER_API_KEY || "";

/** False on Railway and local dev, where the portal does not exist. */
export function identityConfigured(): boolean {
  return Boolean(MASTER_API_URL && MASTER_API_KEY);
}

/**
 * Best-effort person id for a learner.
 *
 * Returns null rather than throwing, for every failure mode. Callers store
 * whatever comes back and carry on.
 */
export async function resolvePersonId(
  email: string,
  name?: string | null,
  employeeCode?: string | null,
): Promise<string | null> {
  if (!identityConfigured()) return null;
  const address = (email || "").trim().toLowerCase();
  if (!address || !address.includes("@")) return null;

  try {
    const res = await fetch(`${MASTER_API_URL}/api/identity/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-master-key": MASTER_API_KEY },
      body: JSON.stringify({
        email: address,
        name: name || undefined,
        employee_code: employeeCode || undefined,
        // Open, unlike the roll-bound apps: create an external person when the
        // learner is not on the master.
        create: true,
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[identity] resolve returned ${res.status} for ${address}`);
      return null;
    }
    const person = (await res.json()) as { person_id?: string };
    return person.person_id ?? null;
  } catch (err) {
    console.warn("[identity] resolve failed:", (err as Error).message);
    return null;
  }
}
