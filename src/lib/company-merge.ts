/**
 * Deciding when two company names are the same firm, and which record wins.
 *
 * Split out of the import action so both rules can be tested directly. The
 * first version of the normaliser shipped as a silent no-op — an escaping
 * mistake had put literal control characters in the regex, so it matched
 * nothing while typecheck, tests and build all passed. Rules that decide which
 * records get merged should not be provable only by reading them.
 */

/**
 * A company name reduced to something comparable.
 *
 * Used ONLY to decide whether a name the master supplies is a firm LMS already
 * knows. Never to rename anything: the wording HR chose stays.
 *
 * "RDC Concrete (India) Limited" and "RDC Concrete India Ltd." are the same
 * company, and treating them as two is what made every imported learner
 * ineligible for existing courses — a course offers only employees whose
 * company is linked to it.
 */
export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    // Legal suffixes first, while the separators are still there to delimit
    // them; punctuation and spacing go afterwards.
    .replace(/limited/g, "ltd")
    .replace(/private/g, "pvt")
    .replace(/corporation/g, "corp")
    .replace(/incorporated/g, "inc")
    .replace(/[^a-z0-9]/g, "");
}

export interface MergeCandidate {
  id: string;
  name: string;
  createdAt: Date;
  employeeCount: number;
}

/**
 * Which record of a duplicate set survives, and which fold into it.
 *
 * Most employees wins, and ties go to the older record: that is the one HR has
 * been working with, and the one existing courses are most likely already
 * linked to. Choosing the other way round would move the many to the few and
 * quietly change who each course can see.
 */
export function pickSurvivingCompany(group: MergeCandidate[]): {
  keep: MergeCandidate;
  drop: MergeCandidate[];
} {
  const [keep, ...drop] = [...group].sort(
    (a, b) =>
      b.employeeCount - a.employeeCount ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return { keep, drop };
}

/** Group companies by the firm they actually are. Singletons are not duplicates. */
export function groupDuplicateCompanies(companies: MergeCandidate[]): MergeCandidate[][] {
  const groups = new Map<string, MergeCandidate[]>();
  for (const company of companies) {
    const key = normaliseCompany(company.name);
    groups.set(key, [...(groups.get(key) ?? []), company]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
