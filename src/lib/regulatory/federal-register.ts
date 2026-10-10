import type { SourceHttpClient } from "./http";

/**
 * Federal Register access (official API, https://www.federalregister.gov/api/v1) and the
 * deterministic rules that decide which publications are stored and how they are labelled.
 *
 * Classification uses only structured facts from the source: document type, the action line,
 * the effective date, CFR references, agency and title. It does not interpret the document.
 * Anything the rules cannot place is labelled UNKNOWN for a person to read.
 *
 * Limits to be aware of:
 *  - CFR references stop at the part (e.g. "49 CFR 396"), never the section.
 *  - Notices usually carry no CFR reference; for exemption notices the part is inferred from
 *    FMCSA's standard title prefix and recorded as inferred.
 *  - The Federal Register does not carry every FMCSA guidance document or interpretation.
 */

const API = "https://www.federalregister.gov/api/v1";
export const FMCSA_SLUG = "federal-motor-carrier-safety-administration";

export interface FrDocument {
  document_number: string;
  type: string; // "Rule" | "Proposed Rule" | "Notice" | "Presidential Document"
  action?: string | null;
  title: string;
  abstract?: string | null;
  publication_date: string; // YYYY-MM-DD
  effective_on?: string | null;
  dates?: string | null;
  cfr_references?: Array<{ title?: number | string; part?: number | string }> | null;
  correction_of?: string | null;
  docket_ids?: string[] | null;
  html_url: string;
  agencies?: Array<{ name?: string; raw_name?: string; slug?: string }> | null;
}

const FIELDS = ["document_number", "type", "action", "title", "abstract", "publication_date", "effective_on", "dates", "cfr_references", "correction_of", "docket_ids", "html_url", "agencies"];

function searchUrl(conditions: Record<string, string | string[]>, perPage = 100): string {
  const q: string[] = [];
  for (const [k, v] of Object.entries(conditions)) for (const item of Array.isArray(v) ? v : [v]) q.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
  for (const f of FIELDS) q.push(`${encodeURIComponent("fields[]")}=${encodeURIComponent(f)}`);
  q.push(`per_page=${perPage}`, "order=newest");
  return `${API}/documents.json?${q.join("&")}`;
}

/** Follow pagination up to `maxPages`. Returns the documents and whether the result was cut short. */
async function searchAll(http: SourceHttpClient, url: string, maxPages: number): Promise<{ docs: FrDocument[]; truncated: boolean; total: number }> {
  const docs: FrDocument[] = [];
  let next: string | undefined = url;
  let total = 0;
  for (let page = 0; next && page < maxPages; page++) {
    const data: { count?: number; results?: FrDocument[]; next_page_url?: string } = await http.getJson(next);
    total = data.count ?? total;
    for (const d of data.results ?? []) if (d && typeof d.document_number === "string" && typeof d.title === "string") docs.push(d);
    next = typeof data.next_page_url === "string" && data.next_page_url.startsWith(`${API}/`) ? data.next_page_url : undefined;
  }
  return { docs, truncated: !!next, total };
}

export interface FrFetchResult {
  docs: FrDocument[];
  /** True if a query had more pages than were read — the run must be reported as partial. */
  truncated: boolean;
  queries: Array<{ label: string; total: number; read: number }>;
}

/**
 * Two queries:
 *  1. Everything FMCSA published since `since` (rules, proposals and notices).
 *  2. Title 49 rules and proposed rules from any agency since `lookbackSince` — catches other DOT
 *     agencies amending monitored parts (e.g. Part 40) and rules published earlier that are not yet effective.
 */
export async function fetchFederalRegister(http: SourceHttpClient, opts: { since: string; lookbackSince: string; maxPages?: number }): Promise<FrFetchResult> {
  const maxPages = opts.maxPages ?? 6;
  const fmcsa = await searchAll(http, searchUrl({ "conditions[agencies][]": FMCSA_SLUG, "conditions[publication_date][gte]": opts.since }), maxPages);
  const title49 = await searchAll(
    http,
    searchUrl({ "conditions[cfr][title]": "49", "conditions[type][]": ["RULE", "PRORULE"], "conditions[publication_date][gte]": opts.lookbackSince }),
    maxPages,
  );
  const byNumber = new Map<string, FrDocument>();
  for (const d of [...fmcsa.docs, ...title49.docs]) if (!byNumber.has(d.document_number)) byNumber.set(d.document_number, d);
  return {
    docs: [...byNumber.values()],
    truncated: fmcsa.truncated || title49.truncated,
    queries: [
      { label: `FMCSA, all types, since ${opts.since}`, total: fmcsa.total, read: fmcsa.docs.length },
      { label: `Title 49 rules and proposed rules, since ${opts.lookbackSince}`, total: title49.total, read: title49.docs.length },
    ],
  };
}

// ───────────────────────── Classification ─────────────────────────

export type ActionType = "FINAL_RULE" | "PROPOSED_RULE" | "INTERIM_FINAL_RULE" | "CORRECTION" | "DELAY" | "STAY" | "WITHDRAWAL" | "EXEMPTION" | "NOTICE";
export type LegalStatus = "PROPOSED" | "FINAL_NOT_YET_EFFECTIVE" | "EFFECTIVE" | "STAYED" | "WITHDRAWN" | "NOTICE" | "UNKNOWN";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface Classification {
  store: boolean;
  /** Why a publication was not stored (recorded in the run log). */
  skipReason?: string;
  actionType: ActionType;
  legalStatus: LegalStatus;
  priority: Priority;
  /** Monitored Title 49 parts this publication concerns. */
  cfrParts: string[];
  /** All Title 49 parts the publication references, monitored or not. */
  allParts: string[];
  /** "cfr_references" (from the source) or "title" (inferred from FMCSA's standard title prefix) or "none". */
  partsBasis: "cfr_references" | "title" | "none";
  isFmcsa: boolean;
}

export interface ClassifyContext {
  /** Today, YYYY-MM-DD. */
  today: string;
  monitoredParts: ReadonlySet<string>;
  /** Publications on or after this date are always in scope. */
  since: string;
}

/** FMCSA's standard notice-title prefixes → the CFR part they concern. Used only when a notice has no CFR reference. */
const TITLE_PART_HINTS: Array<[RegExp, string]> = [
  [/^hours of service/i, "395"],
  [/electronic logging device/i, "395"],
  [/^parts and accessories necessary for safe operation/i, "393"],
  [/^qualification of drivers/i, "391"],
  [/^commercial driver'?s licen[cs]e/i, "383"],
  [/^controlled substances and alcohol/i, "382"],
  [/^inspection, repair,? and maintenance/i, "396"],
  [/^driving of commercial motor vehicles/i, "392"],
];

const INDIVIDUAL_MEDICAL = /^qualification of drivers;\s*exemption applications?;\s*(vision|hearing|epilepsy|diabetes|implantable|narcolepsy|seizure|monocular)/i;
const INFORMATION_COLLECTION = /^agency information collection/i;

export function title49Parts(doc: FrDocument): string[] {
  return [...new Set((doc.cfr_references ?? []).filter((r) => String(r.title) === "49" && r.part !== undefined && r.part !== null).map((r) => String(r.part)))];
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Decide whether a publication is stored and how it is labelled. Pure and deterministic. */
export function classifyDocument(doc: FrDocument, ctx: ClassifyContext): Classification {
  const action = (doc.action ?? "").toLowerCase();
  const title = doc.title ?? "";
  const isFmcsa = (doc.agencies ?? []).some((a) => a.slug === FMCSA_SLUG);
  const allParts = title49Parts(doc);
  let cfrParts = allParts.filter((p) => ctx.monitoredParts.has(p));
  let partsBasis: Classification["partsBasis"] = allParts.length ? "cfr_references" : "none";

  const isRule = doc.type === "Rule";
  const isProposed = doc.type === "Proposed Rule";
  const isNotice = doc.type === "Notice";
  const future = !!doc.effective_on && doc.effective_on > ctx.today;

  // ── Action type, from the document's own action line ──
  let actionType: ActionType;
  if (/withdraw/.test(action)) actionType = "WITHDRAWAL";
  else if (doc.correction_of || /\bcorrection\b|correcting amendment/.test(action)) actionType = "CORRECTION";
  else if (/\bstay\b|stayed|suspension of/.test(action)) actionType = "STAY";
  else if (/delay|extension of (the )?(effective|compliance) date|postpone/.test(action)) actionType = "DELAY";
  else if (/interim final rule/.test(action)) actionType = "INTERIM_FINAL_RULE";
  else if (isProposed) actionType = "PROPOSED_RULE";
  // The "Rules" section also carries notifications, guidance and policy statements. Only an action line
  // that says it is a rule or an amendment is labelled a final rule; anything else is a notice to be read.
  else if (isRule) actionType = !action || /\brule\b|\bamendments?\b/.test(action) ? "FINAL_RULE" : "NOTICE";
  else if (/exemption/.test(action) || /exemption/i.test(title)) actionType = "EXEMPTION";
  else actionType = "NOTICE";

  // ── Legal status. A proposal is never binding, whatever its action line says. ──
  let legalStatus: LegalStatus;
  if (actionType === "WITHDRAWAL") legalStatus = "WITHDRAWN";
  else if (isProposed) legalStatus = "PROPOSED";
  else if (isNotice) legalStatus = "NOTICE";
  else if (actionType === "STAY") legalStatus = "STAYED";
  else if (isRule && actionType === "NOTICE") legalStatus = "UNKNOWN"; // published with the rules but not self-described as one — a person must read it
  else if (isRule) legalStatus = !doc.effective_on ? "UNKNOWN" : future ? "FINAL_NOT_YET_EFFECTIVE" : "EFFECTIVE";
  else legalStatus = "UNKNOWN";

  const base = { actionType, legalStatus, cfrParts, allParts, partsBasis, isFmcsa };
  const skip = (skipReason: string): Classification => ({ ...base, store: false, skipReason, priority: "LOW" });

  // ── Rules and proposed rules ──
  if (isRule || isProposed) {
    if (!isFmcsa && cfrParts.length === 0) return skip("Other agency; does not reference a monitored CFR part");

    // Baseline window: before `since`, keep only what is still pending (not yet effective, or still a proposal).
    if (doc.publication_date < ctx.since) {
      const pending = legalStatus === "PROPOSED" || legalStatus === "FINAL_NOT_YET_EFFECTIVE" || legalStatus === "STAYED" || legalStatus === "UNKNOWN";
      if (!pending) return skip("Already in effect before the compliance library was last checked against the eCFR");
    }

    let priority: Priority = "NORMAL";
    if (cfrParts.length === 0) priority = "LOW"; // FMCSA rule on a part no current scenario cites
    else if (legalStatus === "FINAL_NOT_YET_EFFECTIVE") priority = daysBetween(ctx.today, doc.effective_on!) <= 30 ? "URGENT" : "HIGH";
    else if (actionType === "NOTICE") priority = "NORMAL";
    else if (legalStatus === "EFFECTIVE" || legalStatus === "STAYED" || legalStatus === "WITHDRAWN" || legalStatus === "UNKNOWN") priority = "HIGH";
    return { ...base, store: true, priority };
  }

  // ── Notices ──
  if (isNotice) {
    if (doc.publication_date < ctx.since) return skip("Notice published before the monitoring window");
    if (INFORMATION_COLLECTION.test(title)) return skip("Information-collection notice");
    if (INDIVIDUAL_MEDICAL.test(title)) return skip("Individual driver medical exemption");

    if (cfrParts.length === 0 && allParts.length === 0) {
      const hint = TITLE_PART_HINTS.find(([re]) => re.test(title));
      if (hint && ctx.monitoredParts.has(hint[1])) {
        cfrParts = [hint[1]];
        partsBasis = "title";
      }
    }
    const withParts = { ...base, cfrParts, partsBasis };

    if (actionType === "EXEMPTION") {
      const decides = /grant|renew|modif|revo[ck]|rescind|rescission|terminat|extension of exemption/.test(action);
      const denied = /denial|denied/.test(action);
      if (denied && !/grant/.test(action)) return { ...withParts, store: false, skipReason: "Exemption application denied — no change to any requirement", priority: "LOW" };
      if (!decides) return { ...withParts, store: false, skipReason: "Exemption application or request for comments — no decision yet", priority: "LOW" };
      if (cfrParts.length === 0) return { ...withParts, store: false, skipReason: "Exemption decision that does not concern a monitored CFR part", priority: "LOW" };
      return { ...withParts, store: true, priority: "LOW" };
    }
    if (cfrParts.length > 0 && partsBasis === "cfr_references") return { ...withParts, store: true, priority: "LOW" };
    return { ...withParts, store: false, skipReason: "Notice that does not reference a monitored CFR part", priority: "LOW" };
  }

  return skip(`Document type not monitored: ${doc.type}`);
}

/**
 * Later final rules that share a docket with a proposed rule — i.e. the proposal has probably been
 * acted on. Docket numbers come from the source; this links documents, it does not interpret them.
 */
export function laterRulesInSameDocket(proposal: FrDocument, all: FrDocument[]): string[] {
  if (proposal.type !== "Proposed Rule") return [];
  const dockets = new Set((proposal.docket_ids ?? []).filter(Boolean));
  if (!dockets.size) return [];
  return all
    .filter((d) => d.type === "Rule" && d.publication_date >= proposal.publication_date && d.document_number !== proposal.document_number && (d.docket_ids ?? []).some((x) => dockets.has(x)))
    .map((d) => d.document_number);
}

/** Short factual summary built only from source fields. */
export function summarize(doc: FrDocument, c: Classification): string {
  const parts = c.cfrParts.length ? `49 CFR Part${c.cfrParts.length > 1 ? "s" : ""} ${c.cfrParts.join(", ")}` : c.allParts.length ? `49 CFR Part${c.allParts.length > 1 ? "s" : ""} ${c.allParts.join(", ")} (not cited by any current scenario)` : "no CFR part stated";
  const action = (doc.action ?? doc.type).replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const eff = doc.effective_on ? `effective ${doc.effective_on}` : "no effective date in the source data";
  return `${action}: ${doc.title.replace(/\s+/g, " ").trim()} — ${parts}; published ${doc.publication_date}; ${eff}.`.slice(0, 900);
}
