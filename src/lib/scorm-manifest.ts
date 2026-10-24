/**
 * Reading a SCORM package's imsmanifest.xml: which version it is, what to
 * launch, and whether it is the single-unit kind this LMS plays.
 *
 * A small XML reader of our own rather than a dependency: a manifest is a plain
 * tree of tags, and all we need is names, attributes and text. Namespace
 * prefixes (adlcp:scormType) are dropped so SCORM 1.2 and 2004 read the same.
 */

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

const local = (name: string) => name.slice(name.lastIndexOf(":") + 1);

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const match of xml.matchAll(tag)) {
    const [whole, cdata, closing, opening, attributes, selfClosing, text] = match;
    const top = stack[stack.length - 1];
    if (cdata !== undefined) { top.text += cdata; continue; }
    if (closing) {
      if (stack.length > 1 && local(stack[stack.length - 1].name) === local(closing)) stack.pop();
      continue;
    }
    if (opening) {
      const attrs: Record<string, string> = {};
      for (const attr of (attributes ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[local(attr[1])] = decode(attr[2] ?? attr[3] ?? "");
      }
      const node: XmlNode = { name: local(opening), attrs, children: [], text: "" };
      top.children.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }
    if (text !== undefined && !whole.startsWith("<")) top.text += decode(text);
  }
  return root.children[0] ?? root;
}

const child = (node: XmlNode | undefined, name: string) => node?.children.find((c) => c.name === name);
const kids = (node: XmlNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? [];
const textOf = (node: XmlNode | undefined) => node?.text.replace(/\s+/g, " ").trim() ?? "";
function descendants(node: XmlNode, name: string, found: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) found.push(c);
    descendants(c, name, found);
  }
  return found;
}

export type ScormManifest = {
  version: "1.2" | "2004";
  title: string;
  /** Path of the page to open, relative to the package root, including any query string. */
  launchPath: string;
  /** The pass mark the package declares (a percentage), when it declares one. */
  masteryScore: number | null;
  /** Number of launchable units. This LMS plays exactly one. */
  scoCount: number;
};

export class ScormManifestError extends Error {}

function detectVersion(root: XmlNode, raw: string): "1.2" | "2004" {
  const schemaVersion = textOf(child(child(root, "metadata"), "schemaversion"));
  if (/^1\.2$/i.test(schemaVersion)) return "1.2";
  if (/2004|CAM\s*1\.3|1\.3/i.test(schemaVersion)) return "2004";
  if (/adlcp_v1p3|adlnav_v1p3|imsss/i.test(raw)) return "2004";
  if (/adlcp_rootv1p2|adlcp_v1p2/i.test(raw)) return "1.2";
  throw new ScormManifestError("This does not look like a SCORM 1.2 or SCORM 2004 package (no SCORM version in imsmanifest.xml).");
}

export function parseScormManifest(xml: string): ScormManifest {
  const root = parseXml(xml);
  if (root.name !== "manifest") throw new ScormManifestError("imsmanifest.xml is not a SCORM manifest.");
  const version = detectVersion(root, xml);

  const organizations = child(root, "organizations");
  const orgs = kids(organizations, "organization");
  const organization = orgs.find((o) => o.attrs.identifier === organizations?.attrs.default) ?? orgs[0];
  if (!organization) throw new ScormManifestError("The package has no course structure (no organization in imsmanifest.xml).");

  const resources = new Map<string, XmlNode>();
  for (const resource of kids(child(root, "resources"), "resource")) resources.set(resource.attrs.identifier, resource);

  // Every item that points at a resource is something to launch.
  const launchable = descendants(organization, "item").filter((item) => item.attrs.identifierref && resources.has(item.attrs.identifierref));
  if (!launchable.length) throw new ScormManifestError("The package has nothing to launch (no item points at a resource).");
  const sharedResources = new Set(launchable.map((item) => item.attrs.identifierref));
  if (sharedResources.size > 1) {
    throw new ScormManifestError(`This package has ${sharedResources.size} separate units. Only single-unit packages (like Articulate Storyline and Rise exports) are supported.`);
  }

  const item = launchable[0];
  const resource = resources.get(item.attrs.identifierref)!;
  const href = resource.attrs.href;
  if (!href) throw new ScormManifestError("The launch resource has no file to open (no href).");
  const base = resource.attrs.base ?? child(root, "resources")?.attrs.base ?? "";
  const parameters = item.attrs.parameters ?? "";
  const launchPath = `${base}${href}${parameters}`.replace(/^\.\//, "");

  const mastery = textOf(descendants(item, "masteryscore")[0]);
  // 2004 puts the pass mark in sequencing as a 0-1 fraction.
  const scaled = textOf(descendants(organization, "minNormalizedMeasure")[0]);
  const masteryScore = mastery && Number.isFinite(Number(mastery)) ? Number(mastery)
    : scaled && Number.isFinite(Number(scaled)) ? Math.round(Number(scaled) * 100) : null;

  return {
    version,
    title: textOf(child(organization, "title")) || textOf(child(item, "title")) || "SCORM course",
    launchPath,
    masteryScore,
    scoCount: sharedResources.size,
  };
}
