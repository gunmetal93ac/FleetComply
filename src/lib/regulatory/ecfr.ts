import { createHash } from "node:crypto";
import type { SourceHttpClient } from "./http";

/**
 * eCFR access (official versioner API, https://www.ecfr.gov/api/versioner/v1).
 *
 *   titles.json                               → latest issue date of each title
 *   versions/title-49.json?part=N             → amendment history of every section in a part
 *   full/<date>/title-49.xml?part=N&section=S → text of one section as of a date
 *
 * The text is treated as data: tags are stripped, entities decoded, whitespace normalised.
 * Nothing in it is executed or interpreted.
 */

const API = "https://www.ecfr.gov/api/versioner/v1";

export interface EcfrSectionVersion {
  identifier: string; // "396.9"
  amendment_date: string; // "2026-07-22"
  date?: string;
  issue_date?: string;
  name?: string;
  removed?: boolean;
  substantive?: boolean;
  type?: string;
  subpart?: string | null;
}

export interface SectionStatus {
  section: string;
  /** Most recent amendment date in the eCFR history — the version reference we store. */
  latestAmendment: string;
  heading: string | null;
  removed: boolean;
  /** Subpart letter the eCFR files the section under, when it reports one. */
  subpart?: string | null;
}

export async function latestIssueDate(http: SourceHttpClient, title = 49): Promise<string> {
  const data = await http.getJson<{ titles?: Array<{ number: number; latest_issue_date?: string }> }>(`${API}/titles.json`);
  const t = data.titles?.find((x) => x.number === title);
  if (!t?.latest_issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(t.latest_issue_date)) throw new Error(`eCFR did not report a latest issue date for title ${title}`);
  return t.latest_issue_date;
}

/** Amendment history for one part, reduced to the latest state of each section. */
export async function partStatus(http: SourceHttpClient, part: string, title = 49): Promise<Map<string, SectionStatus>> {
  if (!/^\d+$/.test(part)) throw new Error(`Invalid CFR part: ${part}`);
  const data = await http.getJson<{ content_versions?: EcfrSectionVersion[] }>(`${API}/versions/title-${title}.json?part=${part}`);
  if (!Array.isArray(data.content_versions)) throw new Error(`eCFR returned no version list for part ${part}`);
  return latestBySection(data.content_versions);
}

export function latestBySection(versions: EcfrSectionVersion[]): Map<string, SectionStatus> {
  const out = new Map<string, SectionStatus>();
  for (const v of versions) {
    if (typeof v.identifier !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.amendment_date ?? "")) continue;
    const cur = out.get(v.identifier);
    if (!cur || v.amendment_date > cur.latestAmendment)
      out.set(v.identifier, { section: v.identifier, latestAmendment: v.amendment_date, heading: cleanHeading(v.name), removed: v.removed === true, subpart: typeof v.subpart === "string" ? v.subpart : null });
  }
  return out;
}

function cleanHeading(name?: string): string | null {
  if (!name) return null;
  return name.replace(/\s+/g, " ").trim().slice(0, 300) || null;
}

export function sectionTextUrl(issueDate: string, section: string, title = 49): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new Error(`Invalid issue date: ${issueDate}`);
  if (!/^\d+\.\d+[A-Za-z]?$/.test(section)) throw new Error(`Invalid section: ${section}`);
  return `${API}/full/${issueDate}/title-${title}.xml?part=${section.split(".")[0]}&section=${section}`;
}

export async function fetchSectionText(http: SourceHttpClient, issueDate: string, section: string, title = 49): Promise<{ text: string; hash: string; url: string }> {
  const url = sectionTextUrl(issueDate, section, title);
  const xml = await http.getText(url, "application/xml");
  const text = normalizeSectionXml(xml);
  if (text.length < 20) throw new Error(`eCFR returned no text for § ${section}`);
  return { text, hash: hashText(text), url };
}

const BLOCK = /<\/?(?:P|FP|HEAD|CITA|DIV\d|EXTRACT|NOTE|HED|PSPACE|GPOTABLE|ROW|TR|TABLE|EDNOTE|AUTH|SOURCE|SECAUTH|APPRO|EFFDNOT|LI|TH|TD|ENT|CHED)\b[^>]*>/gi;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** XML → plain text, one paragraph per line. Deterministic, so the same regulation text always hashes the same. */
export function normalizeSectionXml(xml: string): string {
  return xml
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .split("\n")
    .map((line) => line.replace(/[ \t   ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ───────────────────────── Decision ─────────────────────────

export type EcfrDecision =
  | { kind: "BASELINE" } // nothing stored yet: store the current text, raise no alert
  | { kind: "UNCHANGED" } // same amendment date as the stored version
  | { kind: "FETCH_AND_COMPARE" } // a newer amendment exists: fetch the text and compare hashes
  | { kind: "REMOVED" } // the section has been removed from the CFR
  | { kind: "MISSING" }; // the section is not in the part's history — reported as a failure, not as "removed"

/** What to do for one monitored section, given what is stored and what eCFR reports. Pure. */
export function decideEcfr(stored: { versionRef: string } | null, remote: SectionStatus | undefined): EcfrDecision {
  if (!remote) return { kind: "MISSING" };
  if (remote.removed) return stored ? { kind: "REMOVED" } : { kind: "MISSING" };
  if (!stored) return { kind: "BASELINE" };
  return stored.versionRef === remote.latestAmendment ? { kind: "UNCHANGED" } : { kind: "FETCH_AND_COMPARE" };
}
