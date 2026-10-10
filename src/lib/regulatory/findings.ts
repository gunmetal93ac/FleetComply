import { concernsExemption } from "../rules/content-review";
import type { RegulatoryRule, SourceCitation } from "../rules/types";
import { compareSections, ecfrSectionUrl, parseCitation } from "./citations";
import type { SectionStatus } from "./ecfr";

/**
 * Deterministic findings for the Regulatory Verification workflow.
 *
 * Every check here is a fixed rule over citations, links, the eCFR's own section list and stored
 * change records. A finding is something for an administrator to look at, with the official
 * sources and a suggested next action. Checks can establish facts about a CITATION (it is
 * malformed, the section is reserved, the link opens a different section). They cannot establish
 * that a statement of law is right or wrong — anything of that kind is labelled POSSIBLE.
 */

export type FindingSeverity = "PROBLEM" | "POSSIBLE" | "INFO";
export type FindingCode =
  | "NOT_OFFICIAL_SOURCE"
  | "NOT_CHECKABLE"
  | "CITATION_FORMAT"
  | "LINK_TEXT_MISMATCH"
  | "RANGE_COVERED_BY_ONE_LINK"
  | "PART_LEVEL_CITATION"
  | "EXEMPTION_SCOPE"
  | "UNRELATED_TOPIC"
  | "SECTION_MISSING"
  | "SECTION_REMOVED"
  | "SECTION_RESERVED"
  | "AMENDED_SINCE_CHECKED"
  | "CHANGE_DETECTED"
  | "RETRIEVAL_FAILED";

export interface FindingSource {
  label: string;
  url: string;
}

export interface Finding {
  /** Stable identity, so an administrator's disposition stays attached across re-checks. */
  key: string;
  code: FindingCode;
  /** PROBLEM = a fact the check established. POSSIBLE = needs a person to decide. INFO = context. */
  severity: FindingSeverity;
  /** One sentence: what was found. */
  message: string;
  /** Why it matters. */
  explanation: string;
  /** Official sources involved. */
  sources: FindingSource[];
  /** What the administrator would normally do next. */
  nextAction: string;
  /** Whether it concerns the wording customers see now, the proposed correction, or both. */
  appliesTo: "CURRENT" | "PROPOSED" | "BOTH";
  citation?: string;
  section?: string;
  changeId?: string;
}

/** Findings that need no network; everything else comes from a source check. */
export const OFFLINE_CODES: FindingCode[] = ["NOT_OFFICIAL_SOURCE", "NOT_CHECKABLE", "CITATION_FORMAT", "LINK_TEXT_MISMATCH", "RANGE_COVERED_BY_ONE_LINK", "PART_LEVEL_CITATION", "EXEMPTION_SCOPE", "UNRELATED_TOPIC"];

/** What each Title 49 part is about. Used for explanations and to raise "possibly unrelated topic". */
export const PART_SUBJECT: Record<string, string> = {
  "40": "drug and alcohol testing procedures",
  "171": "hazardous materials",
  "172": "hazardous materials",
  "365": "operating authority",
  "366": "process agents",
  "367": "Unified Carrier Registration",
  "376": "equipment leasing",
  "382": "drug and alcohol testing",
  "383": "commercial driver’s licenses",
  "385": "safety fitness and audits",
  "387": "insurance and financial responsibility",
  "390": "general carrier requirements",
  "391": "driver qualification",
  "392": "driving of commercial motor vehicles",
  "393": "vehicle parts and accessories",
  "395": "hours of service",
  "396": "inspection, repair and maintenance",
};
const EXPECTED_PARTS: Partial<Record<RegulatoryRule["recordCategory"], string[]>> = {
  DRUG_ALCOHOL_PROGRAM: ["382", "40", "383", "390", "391"],
  DRIVER_QUALIFICATION_FILE: ["391", "383", "382", "390", "392"],
  DRIVER_INVESTIGATION_HISTORY_FILE: ["391", "382", "40"],
  HAZMAT_TRAINING: ["172", "171", "383"],
  ACCIDENT_RECORDS: ["390", "382", "171"],
};

/**
 * The three regimes a driver-hiring checklist mixes, and the section where each one sets out its
 * OWN applicability and exceptions (headings read from the eCFR, issue 2026-10-05: § 383.3
 * "Applicability", § 382.103 "Applicability", § 391.2 "General exceptions", Part 391 Subpart G
 * "Limited exemptions"). Used to ask one question of an exemption step: does it cite the place
 * where each regime it could affect defines its exceptions? It does not decide the answer.
 */
export const EXCEPTION_REGIMES: Array<{ part: string; subject: string; where: string; sections: (s: string) => boolean; link: string }> = [
  { part: "383", subject: "CDL licensing", where: "§ 383.3", sections: (s) => s === "383.3", link: "383.3" },
  { part: "382", subject: "drug and alcohol testing", where: "§ 382.103", sections: (s) => s === "382.103", link: "382.103" },
  { part: "391", subject: "driver qualification", where: "§ 391.2 and Subpart G (§§ 391.61–391.69)", sections: (s) => s === "391.2" || (compareSections(s, "391.61") >= 0 && compareSections(s, "391.69") <= 0), link: "391.2" },
];

export const isOfficialUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".gov");
  } catch {
    return false;
  }
};

const official = (section: string): FindingSource => ({ label: `49 CFR § ${section}`, url: ecfrSectionUrl(49, section) });

// ───────────────────────── Citation groups (range, subpart, part) ─────────────────────────

const SECTION_RANGE = /(\d+\.\d+[A-Za-z]?)\s*[–-]\s*(\d+\.\d+[A-Za-z]?)/;
const SUBPART = /\bSubpart\s+([A-Z]{1,2})\b/;
const PART = /\bParts?\s+(\d+)\b/;
const ECFR_GROUP_URL = /^https:\/\/www\.ecfr\.gov\/current\/title-49\/(?:[a-z-]+\/)*part-(\d+)(?:\/subpart-([A-Z]{1,2}))?/;

export type GroupKind = "RANGE" | "SUBPART" | "PART";
export interface CitationGroup {
  citation: string;
  kind: GroupKind;
  part: string;
  subpart?: string;
  from?: string;
  to?: string;
  /** The single section the citation's link opens, if it links to one. */
  linkedSection?: string;
}

/** A citation that names more than one section: a range, a subpart, or a whole part. Null for an ordinary single-section citation. */
export function citationGroup(s: SourceCitation): CitationGroup | null {
  const parsed = parseCitation(s);
  const url = s.url.match(ECFR_GROUP_URL);
  const range = s.citation.match(SECTION_RANGE);
  const sub = s.citation.match(SUBPART) ?? (url?.[2] ? [url[2], url[2]] : null);
  const partText = s.citation.match(PART);
  const part = parsed?.part ?? url?.[1] ?? partText?.[1] ?? range?.[1].split(".")[0];
  if (!part) return null;
  if (range && range[1].split(".")[0] === part && range[2].split(".")[0] === part)
    return { citation: s.citation, kind: "RANGE", part, from: range[1], to: range[2], subpart: sub?.[1], linkedSection: parsed?.section };
  if (sub) return { citation: s.citation, kind: "SUBPART", part, subpart: sub[1], linkedSection: parsed?.section };
  // "49 CFR Part 367" — but not "49 CFR 391.23" (a section) and not "Part 391" used only as context after a section number.
  if ((partText || url) && !/\b\d+\.\d+/.test(s.citation)) return { citation: s.citation, kind: "PART", part, linkedSection: parsed?.section };
  return null;
}

export type SectionActivity = "ACTIVE" | "RESERVED" | "REMOVED";
export interface CoverageSection {
  section: string;
  heading: string | null;
  activity: SectionActivity;
  officialUrl: string;
  /** The current step links to this section itself. */
  linkedNow: boolean;
  /** The proposed correction cites this section individually. */
  inCorrection: boolean;
  /** Already on the Regulatory Intelligence watch list for this step. */
  monitored: boolean;
  /**
   * Offered for monitoring by default: an active section a range or subpart citation names. Sections
   * of a part-level citation are never pre-selected — citing a part does not mean every section applies.
   */
  suggested: boolean;
}
export interface CoverageGroup extends CitationGroup {
  origin: "CURRENT" | "PROPOSED" | "BOTH";
  sections: CoverageSection[];
}

export const isReserved = (st: Pick<SectionStatus, "heading">) => /\[Reserved\]/i.test(st.heading ?? "");
export const activityOf = (st: SectionStatus): SectionActivity => (st.removed ? "REMOVED" : isReserved(st) ? "RESERVED" : "ACTIVE");

/** The sections a group citation names, from the eCFR's own list for the part. */
export function sectionsInGroup(g: CitationGroup, partSections: Map<string, SectionStatus>): SectionStatus[] {
  const all = [...partSections.values()].filter((s) => /^\d+\.\d+[A-Za-z]?$/.test(s.section)).sort((a, b) => compareSections(a.section, b.section));
  if (g.kind === "RANGE") return all.filter((s) => compareSections(s.section, g.from!) >= 0 && compareSections(s.section, g.to!) <= 0);
  if (g.kind === "SUBPART") return all.filter((s) => s.subpart === g.subpart);
  return all;
}

// ───────────────────────── Offline findings ─────────────────────────

export function citedSections(sources: SourceCitation[]): string[] {
  return [...new Set(sources.map((s) => parseCitation(s)?.section).filter((p): p is string => !!p))];
}
export function citedParts(sources: SourceCitation[]): string[] {
  return [...new Set(sources.map((s) => parseCitation(s)?.part ?? citationGroup(s)?.part).filter((p): p is string => !!p))];
}

type Draft = Omit<Finding, "appliesTo" | "key"> & { key?: string };
const keyOf = (f: Draft) => f.key ?? `${f.code}|${f.citation ?? f.section ?? f.changeId ?? ""}`;

interface WordingLike {
  title: string;
  requiredAction: string[];
  sources: SourceCitation[];
}

function offlineFor(rule: RegulatoryRule, catalog: RegulatoryRule[], w: WordingLike): Draft[] {
  const out: Draft[] = [];
  for (const s of w.sources) {
    const parsed = parseCitation(s);
    const group = citationGroup(s);
    if (!isOfficialUrl(s.url)) {
      out.push({
        code: "NOT_OFFICIAL_SOURCE", severity: "INFO", citation: s.citation, sources: [],
        message: `“${s.citation}” has no official source link.`,
        explanation: "Without a link to an official source the statement cannot be checked against a regulation, and it cannot be approved as it stands.",
        nextAction: "Find the official source (a CFR section, or the agency’s own page) and add it in a proposed correction — or reword the step so it does not present this as a regulatory requirement.",
      });
      continue;
    }
    if (/\bCFR\b/.test(s.citation) && !/\d+\s*CFR\s*(Parts?\s*)?\d+/i.test(s.citation))
      out.push({
        code: "CITATION_FORMAT", severity: "PROBLEM", citation: s.citation, sources: [{ label: s.citation, url: s.url }],
        message: `“${s.citation}” does not follow the “49 CFR 391.23” form.`,
        explanation: "A citation that cannot be parsed cannot be matched to a section, retrieved or monitored.",
        nextAction: "Rewrite the citation with title, “CFR” and the section number in a proposed correction.",
      });
    if (parsed?.mismatch)
      out.push({
        code: "LINK_TEXT_MISMATCH", severity: "PROBLEM", citation: s.citation, sources: [official(parsed.mismatch), official(parsed.section)],
        message: `The citation names § ${parsed.mismatch} but its link opens § ${parsed.section}.`,
        explanation: "Users who follow the link read a different section from the one cited, and monitoring watches the wrong one.",
        nextAction: `Decide which section is meant. “Draft citation repair” will propose pointing the link at § ${parsed.mismatch}; check that is the section the step relies on before approving.`,
      });
    if (group && (group.kind === "RANGE" || group.kind === "SUBPART"))
      out.push({
        code: "RANGE_COVERED_BY_ONE_LINK", severity: "POSSIBLE", citation: s.citation, sources: [{ label: s.citation, url: s.url }],
        message: `“${s.citation}” names ${group.kind === "RANGE" ? `a range (§§ ${group.from}–${group.to})` : `Subpart ${group.subpart} of Part ${group.part}`}, but ${group.linkedSection ? `its link opens only § ${group.linkedSection}` : "it links to no individual section"}.`,
        explanation: "Only a section that is linked individually is retrieved for review and watched by Regulatory Intelligence. The other sections in the range may be reserved, and a change to any of them would go unnoticed.",
        nextAction: "Run “Check Official Sources” to list each section in the range with its status and link, add the active ones to monitoring, and use “Draft citation repair” to propose citing them individually.",
      });
    else if (group && group.kind === "PART")
      out.push({
        code: "PART_LEVEL_CITATION", severity: "POSSIBLE", citation: s.citation, sources: [{ label: s.citation, url: s.url }],
        message: `“${s.citation}” cites all of Part ${group.part} (${PART_SUBJECT[group.part] ?? "subject not listed"}) rather than a section.`,
        explanation: "A part contains many sections and not all of them bear on this step. Nothing is retrieved or monitored for a part-level citation, and no section is assumed to apply.",
        nextAction: "Run “Check Official Sources” to list the part’s sections, then choose the ones this step actually relies on: add them to monitoring and cite them in a proposed correction.",
      });
    else if (!parsed)
      out.push({
        code: "NOT_CHECKABLE", severity: "INFO", citation: s.citation, sources: [{ label: s.citation, url: s.url }],
        message: `“${s.citation}” links to an official page that is not a CFR section.`,
        explanation: "Agency pages and State law are not retrieved automatically, so no evidence is collected for this citation.",
        nextAction: "Open the link, read the current page yourself, and list it among the sources you relied on when you record a decision.",
      });
  }

  const sections = citedSections(w.sources);
  const parts = citedParts(w.sources);
  if (concernsExemption(w)) {
    const siblings = catalog.filter((r) => r.id !== rule.id && r.workflows.some((wf) => rule.workflows.includes(wf)));
    const siblingParts = new Set(siblings.flatMap((r) => citedParts(r.sources)));
    for (const regime of EXCEPTION_REGIMES) {
      if (!siblingParts.has(regime.part)) continue; // the workflow has no steps under this regime
      const covered = sections.some(regime.sections) || w.sources.some((s) => {
        const g = citationGroup(s);
        return g?.part === regime.part && g.kind !== "PART" && regime.part === "391" && (g.subpart === "G" || (g.from !== undefined && regime.sections(g.from)));
      });
      if (covered) continue;
      const others = parts.filter((p) => p !== regime.part);
      out.push({
        key: `EXEMPTION_SCOPE|${regime.part}`,
        code: "EXEMPTION_SCOPE", severity: "POSSIBLE", section: regime.link, sources: [official(regime.link)],
        message: `This exemption step does not cite ${regime.where}, where Part ${regime.part} (${regime.subject}) sets out its own exceptions — yet other steps in the same workflow are Part ${regime.part} requirements.`,
        explanation: `Each of these parts defines its own applicability and exceptions. ${others.length ? `An exemption found under Part ${others.join(" or ")}` : "An exemption found elsewhere"} does not, by citing it, change a ${regime.subject} requirement. As worded, the step could be read as letting one exemption clear steps that rest on a different part.`,
        nextAction: `Read ${regime.where}. Then either cite it and word the step so the regimes are kept apart (a proposed correction), or mark this finding not applicable with the reason the step cannot affect Part ${regime.part} steps.`,
      });
    }
  }
  const expected = EXPECTED_PARTS[rule.recordCategory];
  if (expected && parts.length && !parts.some((p) => expected.includes(p)))
    out.push({
      code: "UNRELATED_TOPIC", severity: "POSSIBLE", sources: sections.map(official),
      message: `The step is filed under ${rule.recordCategory.replaceAll("_", " ").toLowerCase()} but cites only Part ${parts.join(", ")} (${parts.map((p) => PART_SUBJECT[p] ?? "other").join("; ")}).`,
      explanation: "The cited part is about a different subject from the step. That can be legitimate, or the citation can be wrong; a fixed check cannot tell which.",
      nextAction: "Open the cited section and confirm it supports this step. If not, propose the correct citation; if it does, mark this finding not applicable and say why.",
    });
  return out;
}

/**
 * Offline findings for the wording customers see now and, when there is one, the proposed
 * correction — merged, with each finding saying which of the two it concerns.
 */
export function offlineFindings(rule: RegulatoryRule, catalog: RegulatoryRule[], current: WordingLike, proposed: WordingLike | null = null): Finding[] {
  const now = offlineFor(rule, catalog, current);
  const next = proposed ? offlineFor(rule, catalog, proposed) : null;
  const out = new Map<string, Finding>();
  for (const f of now) out.set(keyOf(f), { ...f, key: keyOf(f), appliesTo: next && !next.some((n) => keyOf(n) === keyOf(f)) ? "CURRENT" : next ? "BOTH" : "CURRENT" });
  for (const f of next ?? []) if (!out.has(keyOf(f))) out.set(keyOf(f), { ...f, key: keyOf(f), appliesTo: "PROPOSED" });
  return [...out.values()];
}

// ───────────────────────── Relevance of a detected regulatory change ─────────────────────────

export interface DetectedChange {
  id: string;
  title: string;
  sourceUrl: string;
  detectedAt: Date;
  status: string;
  /** The section whose stored eCFR text changed — set for text changes, null for Federal Register documents. */
  section: string | null;
  parts: string[];
  legalStatus: string;
  actionType: string | null;
  /** Section numbers the source's own title, summary or citation line names. */
  mentions: string[];
}

export type RelevanceLevel = "CONFIRMED" | "LIKELY" | "POSSIBLE" | "UNLIKELY";
export interface Relevance {
  level: RelevanceLevel;
  why: string;
  sections: string[];
}

/** Section numbers named in a document's own descriptive text, limited to the parts it references. */
export function sectionsMentioned(text: string, parts: string[]): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/§+\s*(\d{1,3}\.\d+[A-Za-z]?)/g)) out.add(m[1]);
  for (const m of text.matchAll(/\b(\d{2,3})\.(\d{1,4}[A-Za-z]?)\b/g)) if (parts.includes(m[1])) out.add(`${m[1]}.${m[2]}`);
  return [...out].sort(compareSections);
}

/**
 * Why a detected change may matter to one step. Section-level evidence is required for anything
 * stronger than "possible"; a shared part number alone is never treated as confirmation.
 */
export function changeRelevance(change: DetectedChange, sections: string[]): Relevance {
  const binding = ["EFFECTIVE", "FINAL_NOT_YET_EFFECTIVE"].includes(change.legalStatus);
  const tail = binding ? "" : ` It is ${change.legalStatus === "PROPOSED" ? "a proposal" : "not a rule in effect"} — nothing in the regulation has changed because of it.`;
  if (change.section && sections.includes(change.section))
    return { level: "CONFIRMED", sections: [change.section], why: `The eCFR text of § ${change.section} — a section this step cites — changed.` };
  const named = change.mentions.filter((m) => sections.includes(m));
  if (named.length) return { level: "LIKELY", sections: named, why: `The document names § ${named.join(", § ")}, which this step cites.${tail}` };
  if (change.mentions.length)
    return { level: "UNLIKELY", sections: [], why: `The document names § ${change.mentions.slice(0, 6).join(", § ")}${change.mentions.length > 6 ? " and others" : ""}; this step cites none of them. It matched only because both concern Part ${change.parts.join(", ")}.${tail}` };
  return { level: "POSSIBLE", sections: [], why: `Part-level match only: the source lists Part ${change.parts.join(", ")} without naming sections, so it may or may not touch § ${sections.filter((s) => change.parts.includes(s.split(".")[0])).join(", § ") || "the sections cited here"}. Open it and check.${tail}` };
}

export function changeFinding(change: DetectedChange, sections: string[], appliesTo: Finding["appliesTo"]): Finding {
  const r = changeRelevance(change, sections);
  const label = { CONFIRMED: "Confirmed", LIKELY: "Likely relevant", POSSIBLE: "Possibly relevant", UNLIKELY: "Probably not relevant" }[r.level];
  return {
    key: `CHANGE_DETECTED|${change.id}`,
    code: "CHANGE_DETECTED",
    severity: r.level === "CONFIRMED" ? "PROBLEM" : r.level === "UNLIKELY" ? "INFO" : "POSSIBLE",
    changeId: change.id,
    appliesTo,
    message: `${label}: “${change.title}” (${change.legalStatus.toLowerCase().replaceAll("_", " ")}).`,
    explanation: r.why,
    sources: [{ label: change.title, url: change.sourceUrl }, ...r.sections.map(official)],
    nextAction:
      r.level === "CONFIRMED" ? "Compare the step with the current text of the section before approving anything."
      : r.level === "LIKELY" ? "Open the document and read what it does to the named section; decide whether the step’s wording is affected."
      : r.level === "POSSIBLE" ? "Open the document and see whether it touches a section this step cites. If it does not, mark this finding not applicable with that reason."
      : "No action is expected. It is listed so you can see why it was not treated as affecting this step.",
  };
}

// ───────────────────────── Administrator dispositions ─────────────────────────

export type Disposition = "RESOLVED" | "NOT_APPLICABLE" | "NEEDS_REVIEW";
export const DISPOSITION_LABEL: Record<Disposition, string> = { RESOLVED: "Resolved", NOT_APPLICABLE: "Not applicable", NEEDS_REVIEW: "Requires further review" };
export interface FindingReview {
  disposition: Disposition;
  note: string;
  by: string;
  at: string;
  /** The finding as it read when the administrator dealt with it. */
  message: string;
}
export type FindingReviews = Record<string, FindingReview[]>;

export const latestReview = (reviews: FindingReviews | null | undefined, key: string): FindingReview | null => reviews?.[key]?.at(-1) ?? null;

/**
 * Findings that still stand in the way of approving `target` content: anything other than INFO
 * that concerns that content and has not been marked resolved or not applicable. A finding about
 * the current wording only does not block approval of a correction that removes it.
 */
export function openFindings(findings: Finding[], reviews: FindingReviews | null | undefined, target: "CURRENT" | "PROPOSED"): Finding[] {
  return findings.filter((f) => f.severity !== "INFO" && (f.appliesTo === "BOTH" || f.appliesTo === target) && !["RESOLVED", "NOT_APPLICABLE"].includes(latestReview(reviews, f.key)?.disposition ?? ""));
}
