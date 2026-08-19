/**
 * Reader for the shared employee master in the portal.
 *
 * LMS kept its own employee list, filled from an Excel upload, which meant HR
 * maintained the same people twice and the two drifted apart between uploads.
 * This lets the list be pulled from the one place that is already refreshed
 * nightly from ZingHR and Truein.
 *
 * The rest of the platform resolves ONE person at a time through
 * lib/identity.ts. This is the bulk read: whole populations, filtered.
 */
const MASTER_API_URL = (process.env.MASTER_API_URL || "").replace(/\/$/, "");
const MASTER_API_KEY = process.env.MASTER_API_KEY || "";

/** Named for the POPULATION, never the vendor — ZingHR and the third-party
 *  system can both be replaced, and the values outlive either. */
export type MasterSource = "onroll" | "offroll";

export interface MasterEmployee {
  employee_code: string;
  employee_name: string;
  designation: string | null;
  location: string | null;
  city: string | null;
  company: string | null;
  official_email_id: string | null;
  contact_number: string | null;
  manager_name: string | null;
  source: string | null;
  /** Joined in by the portal, so an import needs no second call per person. */
  person_id: string | null;
}

export function masterConfigured(): boolean {
  return Boolean(MASTER_API_URL && MASTER_API_KEY);
}

/**
 * Fetch employees, optionally narrowed to on-roll or off-roll.
 *
 * Throws rather than returning a result object: unlike the per-person resolve,
 * there is no sensible way to half-import a list, and the caller is an HR
 * action with a human watching who needs to be told what went wrong.
 */
export async function fetchMasterEmployees(sources: MasterSource[] = []): Promise<MasterEmployee[]> {
  if (!masterConfigured()) {
    throw new Error(
      "The employee master is not configured for this deployment (MASTER_API_URL / MASTER_API_KEY).",
    );
  }

  const query = sources.map((s) => `source=${encodeURIComponent(s)}`).join("&");
  const url = `${MASTER_API_URL}/api/master/employees${query ? `?${query}` : ""}`;

  const res = await fetch(url, {
    headers: { "x-master-key": MASTER_API_KEY },
    // A whole-company read is slower than a single lookup, and an import is
    // something HR waits on deliberately rather than a page render.
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`The employee master returned ${res.status}. Please try again in a minute.`);
  }
  const body = (await res.json()) as { employees?: MasterEmployee[] };
  return body.employees ?? [];
}
