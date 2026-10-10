import type { SourceCitation } from "../rules/types";

/**
 * Deterministic citation parsing for the Regulatory Intelligence dependency map.
 *
 * The rule catalog stores each citation as free text plus an official URL. The URL
 * is the reliable part: eCFR section links have a fixed shape, so the section is read
 * from it. Paragraph designations are read from the citation text on a best-effort
 * basis — matching is dependable at section level and approximate below it.
 *
 * No AI is involved, and nothing here asserts what a regulation says.
 */

export interface ParsedCitation {
  title: number; // CFR title
  part: string; // "391"
  section: string; // "391.23"
  /** Paragraph paths named in the text: "(d)(3)(ii)", or a range "(d)..(g)". Empty = the whole section. */
  paragraphs: string[];
  citationText: string;
  sourceUrl: string;
  /** Set when the citation text names a different section than the link points to. */
  mismatch?: string;
}

const ECFR_SECTION_URL = /^https:\/\/www\.ecfr\.gov\/current\/title-(\d+)\/section-(\d+)\.(\d+[A-Za-z]?)$/;

/** One paragraph designator: (a) (1) (ii) (A). Longer parenthesised words such as "(context)" are not designators. */
const DESIGNATOR = String.raw`\((?:[a-z]|[0-9]{1,2}|[ivx]{2,5}|[A-Z])\)`;
const PATH = String.raw`(?:${DESIGNATOR})+`;
const PATH_OR_RANGE = new RegExp(String.raw`(${PATH})(?:\s*[–-]\s*(${PATH}))?`, "g");

/** True for links that point at one section of the eCFR — the only citations the monitor can track by text. */
export function isEcfrSectionUrl(url: string): boolean {
  return ECFR_SECTION_URL.test(url);
}

export function parseCitation(source: SourceCitation): ParsedCitation | null {
  const m = source.url.match(ECFR_SECTION_URL);
  if (!m) return null;
  const [, title, part, sub] = m;
  const section = `${part}.${sub}`;

  // Only read designators that follow the section number in the text; ignore explanatory tails.
  const text = source.citation;
  const paragraphs: string[] = [];
  for (const hit of text.matchAll(PATH_OR_RANGE)) {
    const value = hit[2] ? `${hit[1]}..${hit[2]}` : hit[1];
    if (!paragraphs.includes(value)) paragraphs.push(value);
  }

  // "49 CFR 391.51(c)" → 391.51. Compare with the link and flag disagreement rather than guess.
  const named = text.match(/(?:CFR|§+)\s*(\d+\.\d+[A-Za-z]?)/);
  const mismatch = named && named[1].toUpperCase() !== section.toUpperCase() ? named[1] : undefined;

  return { title: Number(title), part, section, paragraphs, citationText: text, sourceUrl: source.url, ...(mismatch ? { mismatch } : {}) };
}

/** Official "current" eCFR link for a section — the same shape the catalog uses. */
export function ecfrSectionUrl(title: number, section: string): string {
  return `https://www.ecfr.gov/current/title-${title}/section-${section}`;
}

/** Sort key so 382.107 comes before 382.1203 and 390.5 before 390.21. */
export function sectionSortKey(section: string): [number, number, string] {
  const [part, rest = "0"] = section.split(".");
  const n = parseInt(rest, 10);
  return [Number(part), Number.isNaN(n) ? 0 : n, rest];
}

export function compareSections(a: string, b: string): number {
  const [pa, na, ra] = sectionSortKey(a);
  const [pb, nb, rb] = sectionSortKey(b);
  return pa - pb || na - nb || ra.localeCompare(rb);
}
