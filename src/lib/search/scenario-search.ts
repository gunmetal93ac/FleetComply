import { VISIBLE_SCENARIOS, aliasesOf, type Scenario } from "../workflows/scenarios";
import { CONCEPTS, SCENARIO_KEYWORDS } from "./keywords";

/**
 * Scenario search — deterministic keyword + fuzzy matching, no AI.
 *
 * Query and scenario text go through the same pipeline: lowercase, concept
 * detection (phrases → canonical tokens), tokenize, drop stopwords, light
 * stemming. Each query token is matched against a scenario's tokens (exact,
 * prefix, or small edit distance) and weighted by IDF, so words that appear in
 * every scenario ("driver", "truck") count for little and specific ones
 * ("clearinghouse", "out of service") count for a lot.
 *
 * It only ranks existing scenarios. When nothing scores above MIN_SCORE it
 * returns an empty list — callers must say "no verified workflow found".
 */

export interface SearchResult {
  scenario: Scenario;
  score: number;
  /** Query terms that matched, for display/debugging. */
  matched: string[];
}

const STOP = new Set(
  ("a an the and or but of on in into to for from with by at as is are was were be been being am im i me my mine we us our ours you your " +
    "he him his she her they them their it its this that these those there here what whats which who whom how when where why " +
    "do does did done doing have has had having get got gets getting can could should would will shall may might must " +
    "need needs want wants wanted help know about just so if then than up down over out off very really some any all " +
    "one two our s t ve ll d re let lets please tell happen happened happens going go")
    .split(" "),
);

export function stem(w: string): string {
  if (w.length <= 3) return w;
  let s = w;
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("es") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) s = s.slice(0, -1);
  if (s.endsWith("e") && s.length > 3) s = s.slice(0, -1);
  return s;
}

/** Concept tokens found in `text` plus stemmed word tokens. */
export function analyze(text: string): string[] {
  const lower = text.toLowerCase().replace(/[’']/g, "");
  const concepts = CONCEPTS.filter(([, re]) => re.test(lower)).map(([t]) => t);
  const words = lower
    .split(/[^a-z0-9_]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.startsWith("_") ? w : stem(w)))
    .filter((w) => w.length > 1);
  return [...new Set([...concepts, ...words])];
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Same letters with one adjacent pair swapped ("tset" / "test"). */
function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const diff = [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

/** 0..1 — how well query token `q` matches document token `d`. */
function quality(q: string, d: string): number {
  if (q === d) return 1;
  if (q.startsWith("_") || d.startsWith("_")) return 0;
  const min = Math.min(q.length, d.length);
  if (min >= 4 && (d.startsWith(q) || q.startsWith(d))) return 0.75;
  if (min >= 4 && isTransposition(q, d)) return 0.7;
  // Short words that differ by one letter are often different words (bread/break), so require length.
  if (min >= 6 && levenshtein(q, d, 1) <= 1) return 0.7;
  if (min >= 8 && levenshtein(q, d, 2) <= 2) return 0.5;
  return 0;
}

interface Doc {
  scenario: Scenario;
  /** token → field boost (best field the token appears in) */
  tokens: Map<string, number>;
  /** Concepts in the title — what the scenario is primarily about. */
  titleConcepts: string[];
}

const TITLE_BOOST = 1.5;
const KEYWORD_BOOST = 1.3;
const BODY_BOOST = 1;
const CONCEPT_BOOST = 1.5;
const LIVE_BOOST = 1.15;
const UNMENTIONED_TOPIC_PENALTY = 0.9;
/** Below this, a match is too weak to suggest (e.g. only generic words matched). */
export const MIN_SCORE = 2.2;
/** Drop results scoring under this fraction of the best result. */
const RELATIVE_CUTOFF = 0.35;
/**
 * At least one matched term must be this specific (IDF). Words found in most
 * scenarios ("driver") can't produce a suggestion on their own.
 */
const MIN_SPECIFIC_IDF = 1.2;

function buildDocs(scenarios: Scenario[]): Doc[] {
  return scenarios.map((s) => {
    const tokens = new Map<string, number>();
    const add = (text: string, boost: number) => {
      for (const t of analyze(text)) tokens.set(t, Math.max(tokens.get(t) ?? 0, t.startsWith("_") ? boost * CONCEPT_BOOST : boost));
    };
    add(s.determines, BODY_BOOST);
    add((SCENARIO_KEYWORDS[s.n] ?? []).join(" , "), KEYWORD_BOOST);
    // Scenarios merged into this one contribute their wording as aliases.
    for (const alias of aliasesOf(s.n)) add([alias.title, alias.determines, ...(SCENARIO_KEYWORDS[alias.n] ?? [])].join(" , "), KEYWORD_BOOST);
    add(s.title, TITLE_BOOST);
    return { scenario: s, tokens, titleConcepts: analyze(s.title).filter((t) => t.startsWith("_")) };
  });
}

function buildIdf(docs: Doc[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tokens.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + docs.length / n));
  return idf;
}

const DOCS = buildDocs(VISIBLE_SCENARIOS);
const IDF = buildIdf(DOCS);

/**
 * For query words that aren't in the vocabulary (usually typos), find the
 * closest known word and add any concept it implies — "acident" → "accident"
 * → _accident — so a misspelling ranks the same way the correct word would.
 */
function conceptsFromCorrections(tokens: string[]): string[] {
  let changed = false;
  const corrected = tokens.map((t) => {
    if (t.startsWith("_") || IDF.has(t)) return t;
    let best: string | undefined;
    let bestQ = 0;
    for (const v of IDF.keys()) {
      const m = quality(t, v);
      if (m > bestQ || (m === bestQ && m > 0 && best && (IDF.get(v) ?? 0) < (IDF.get(best) ?? 0))) {
        best = v;
        bestQ = m;
      }
    }
    if (!best || bestQ < 0.7) return t;
    changed = true;
    return best;
  });
  if (!changed) return [];
  const text = corrected.join(" ");
  return CONCEPTS.filter(([, re]) => re.test(text)).map(([c]) => c);
}

export function searchScenarios(query: string, limit = 8): SearchResult[] {
  const base = analyze(query);
  const q = [...new Set([...base, ...conceptsFromCorrections(base)])];
  if (!q.length) return [];

  const scored = DOCS.map((doc) => {
    let score = 0;
    let specific = false;
    const matched: string[] = [];
    for (const qt of q) {
      let best = 0;
      let bestIdf = 0;
      for (const [dt, boost] of doc.tokens) {
        const m = quality(qt, dt);
        if (m === 0) continue;
        const idf = IDF.get(dt) ?? 0;
        const v = m * boost * idf;
        if (v > best) {
          best = v;
          bestIdf = idf;
        }
      }
      if (best > 0) {
        score += best;
        matched.push(qt);
        // A query word that exists in the vocabulary is judged by its own rarity, not by a rarer word it fuzzily resembles.
        if ((IDF.get(qt) ?? bestIdf) >= MIN_SPECIFIC_IDF) specific = true;
      }
    }
    if (doc.scenario.status === "LIVE") score *= LIVE_BOOST;
    // The scenario is centrally about something the user didn't mention (e.g. hiring, when they asked about an accident).
    score *= UNMENTIONED_TOPIC_PENALTY ** doc.titleConcepts.filter((c) => !q.includes(c)).length;
    return { scenario: doc.scenario, score: specific ? score : 0, matched };
  })
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.scenario.n - b.scenario.n);

  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((r) => r.score >= top * RELATIVE_CUTOFF).slice(0, limit);
}
