import type { SourceCitation } from "../types";

/** Official eCFR "current" link for a Title 49 section. */
export const ecfr = (section: string, citation?: string): SourceCitation => ({
  citation: citation ?? `49 CFR ${section}`,
  url: `https://www.ecfr.gov/current/title-49/section-${section}`,
});

/**
 * Most recent date any Title 49 entry in this catalog release was checked against eCFR.
 * Each rule carries its own `lastVerified` date — entries added in 2026.10.0 were
 * checked on 2026-10-08, entries added in 2026.10.1 and 2026.10.2 on 2026-10-09, entries added in 2026.10.3 on 2026-10-10.
 */
export const CATALOG_VERIFIED_ON = "2026-10-10";
export const CATALOG_VERSION = "2026.10.3";

/**
 * eCFR issue date the catalog's Title 49 entries were read against. The regulatory monitor treats
 * Federal Register publications on or after this date as not yet reflected in the catalog.
 * Update it whenever the catalog is re-checked against a newer eCFR issue.
 */
export const CATALOG_CHECKED_AGAINST_ECFR_ISSUE = "2026-10-05";
