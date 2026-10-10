import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertAllowedUrl, retryAfterMs, SourceHttpClient, SourceRequestError, type FetchLike } from "../src/lib/regulatory/http";
import { decideEcfr, hashText, latestBySection, normalizeSectionXml, sectionTextUrl } from "../src/lib/regulatory/ecfr";
import { classifyDocument, FMCSA_SLUG, type FrDocument } from "../src/lib/regulatory/federal-register";
import { runEcfrCheck, runFederalRegisterCheck, defaultWindow, type MonitorStore, type NewChange, type RunStatus, type SourceKey, type StoredProvision } from "../src/lib/regulatory/monitor";
import { impactOfParts, impactOfProvision } from "../src/lib/regulatory/dependencies";

/**
 * Regulatory Intelligence — Stage 2 (monitoring).
 *
 * EVERY regulation, amendment and Federal Register document in this file is SIMULATED TEST DATA.
 * Document numbers begin with "SIM-" and section text is invented. None of it describes a real
 * DOT or FMCSA action. No test contacts the network.
 */

// ───────────────────────── Test doubles ─────────────────────────

interface Route {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Fail this many times (with `failStatus`) before succeeding. Infinity = always fail. */
  failTimes?: number;
  failStatus?: number;
  throwError?: string;
}

function fakeHttp(routes: Record<string, Route | (() => Route)>, opts: { maxAttempts?: number } = {}) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { status: 404, ok: false, headers: { get: () => null }, text: async () => "not found" };
    const entry = routes[key];
    const r = typeof entry === "function" ? entry() : entry;
    if (r.failTimes && r.failTimes > 0) {
      r.failTimes--;
      if (r.throwError) throw new Error(r.throwError);
      const status = r.failStatus ?? 503;
      return { status, ok: false, headers: { get: (n) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => "" };
    }
    const status = r.status ?? 200;
    return { status, ok: status >= 200 && status < 300, headers: { get: (n) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => r.body ?? "" };
  };
  const http = new SourceHttpClient({ fetchImpl, sleep: async (ms) => void sleeps.push(ms), minIntervalMs: 0, baseBackoffMs: 100, maxAttempts: opts.maxAttempts ?? 3 });
  return { http, calls, sleeps };
}

class MemoryStore implements MonitorStore {
  provisions: Array<{ id: string; title: number; part: string; section: string; lastCheckedAt: Date | null; lastChangedAt: Date | null; heading: string | null }> = [];
  versions: Array<{ id: string; provisionId: string; versionRef: string; contentHash: string; text: string; seq: number }> = [];
  changes: NewChange[] = [];
  runs: Array<{ id: string; source: SourceKey; trigger: string; status: RunStatus | "RUNNING"; attempt: number; provisionsChecked: number; changesDetected: number; error: string | null; details: Record<string, any> }> = [];
  locks = new Map<SourceKey, boolean>();
  sourceOk = new Map<SourceKey, boolean>();
  private seq = 0;

  constructor(sections: string[]) {
    this.provisions = sections.map((s, i) => ({ id: `p${i}`, title: 49, part: s.split(".")[0], section: s, lastCheckedAt: null, lastChangedAt: null, heading: null }));
  }
  async acquireLock(source: SourceKey) {
    if (this.locks.get(source)) return false;
    this.locks.set(source, true);
    return true;
  }
  async releaseLock(source: SourceKey) {
    this.locks.set(source, false);
  }
  async startRun(source: SourceKey, trigger: string, _by: string | null, attempt: number) {
    const id = `run${this.runs.length}`;
    this.runs.push({ id, source, trigger, status: "RUNNING", attempt, provisionsChecked: 0, changesDetected: 0, error: null, details: {} });
    return id;
  }
  async finishRun(runId: string, r: { status: RunStatus; provisionsChecked: number; changesDetected: number; error: string | null; details: Record<string, unknown> }) {
    Object.assign(this.runs.find((x) => x.id === runId)!, r);
  }
  async markSource(source: SourceKey, ok: boolean) {
    this.sourceOk.set(source, ok);
  }
  async listProvisions(): Promise<StoredProvision[]> {
    return this.provisions.map((p) => {
      const latest = this.versions.filter((v) => v.provisionId === p.id).sort((a, b) => b.seq - a.seq)[0];
      return { id: p.id, title: p.title, part: p.part, section: p.section, latest: latest ? { id: latest.id, versionRef: latest.versionRef, contentHash: latest.contentHash } : null };
    });
  }
  async saveVersion(provisionId: string, v: { versionRef: string; contentHash: string; text: string }) {
    const existing = this.versions.find((x) => x.provisionId === provisionId && x.contentHash === v.contentHash);
    if (existing) {
      existing.versionRef = v.versionRef;
      existing.seq = ++this.seq;
      return { id: existing.id, created: false };
    }
    const row = { id: `v${this.versions.length}`, provisionId, versionRef: v.versionRef, contentHash: v.contentHash, text: v.text, seq: ++this.seq };
    this.versions.push(row);
    return { id: row.id, created: true };
  }
  async markChecked(provisionId: string, at: Date, opts: { changed: boolean; heading: string | null }) {
    const p = this.provisions.find((x) => x.id === provisionId)!;
    p.lastCheckedAt = at;
    if (opts.changed) p.lastChangedAt = at;
    if (opts.heading) p.heading = opts.heading;
  }
  async addChange(c: NewChange) {
    if (this.changes.some((x) => x.source === c.source && x.externalId === c.externalId)) return false;
    this.changes.push(c);
    return true;
  }
}

// SIMULATED eCFR responses.
const titles = { body: JSON.stringify({ titles: [{ number: 49, latest_issue_date: "2030-01-10" }] }) };
const history = (entries: Array<[section: string, amended: string, removed?: boolean]>) => ({
  body: JSON.stringify({ content_versions: entries.map(([identifier, amendment_date, removed]) => ({ identifier, amendment_date, name: `§ ${identifier} SIMULATED heading`, removed: !!removed, type: "section" })) }),
});
const xml = (section: string, text: string) => ({ body: `<?xml version="1.0"?><DIV8 N="${section}" TYPE="SECTION"><HEAD>§ ${section} SIMULATED heading.</HEAD><P>(a) ${text}</P><CITA>[SIMULATED]</CITA></DIV8>` });
const RUN = { trigger: "MANUAL" as const, since: "2030-01-01", lookbackSince: "2029-01-10", today: "2030-01-10", now: () => new Date("2030-01-10T12:00:00Z") };

// ───────────────────────── HTTP layer ─────────────────────────

test("http: only the two official API hosts may be contacted", async () => {
  const { http, calls } = fakeHttp({});
  for (const bad of ["https://example.com/x", "http://www.ecfr.gov/api", "https://www.ecfr.gov.evil.example/api", "https://www.fmcsa.dot.gov/", "file:///etc/passwd", "not a url"]) {
    await assert.rejects(() => http.getText(bad), SourceRequestError, bad);
  }
  assert.equal(calls.length, 0, "a refused URL must never be requested");
  assert.doesNotThrow(() => assertAllowedUrl("https://www.ecfr.gov/api/versioner/v1/titles.json"));
  assert.doesNotThrow(() => assertAllowedUrl("https://www.federalregister.gov/api/v1/documents.json"));
});

test("http: rate-limit and server errors are retried with backoff; Retry-After is honoured", async () => {
  const { http, calls, sleeps } = fakeHttp({ "/titles.json": { failTimes: 2, failStatus: 429, headers: { "retry-after": "7" }, body: "ok" } });
  assert.equal(await http.getText("https://www.ecfr.gov/api/versioner/v1/titles.json"), "ok");
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps.filter((s) => s > 0), [7000, 7000]);
  assert.deepEqual(http.stats, { requests: 3, retries: 2, failures: 0 });
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs(null), undefined);
  assert.equal(retryAfterMs("garbage"), undefined);
});

test("http: gives up after the attempt limit and reports a failure; a 404 is not retried", async () => {
  const down = fakeHttp({ "/titles.json": { failTimes: Infinity, failStatus: 503 } });
  await assert.rejects(() => down.http.getText("https://www.ecfr.gov/api/versioner/v1/titles.json"), (e: unknown) => e instanceof SourceRequestError && e.status === 503);
  assert.equal(down.calls.length, 3);
  assert.equal(down.http.stats.failures, 1);
  assert.deepEqual(down.sleeps.filter((s) => s > 0), [100, 200], "exponential backoff between attempts");

  const missing = fakeHttp({});
  await assert.rejects(() => missing.http.getText("https://www.ecfr.gov/api/versioner/v1/nope"), SourceRequestError);
  assert.equal(missing.calls.length, 1);

  const flaky = fakeHttp({ "/x": { failTimes: 1, throwError: "socket hang up", body: "{\"a\":1}" } });
  assert.deepEqual(await flaky.http.getJson("https://www.ecfr.gov/x"), { a: 1 });
});

// ───────────────────────── eCFR parsing and decisions ─────────────────────────

test("ecfr: text normalisation is deterministic and treats markup as data", () => {
  const a = normalizeSectionXml('<DIV8><HEAD>§ 1.1   Test.</HEAD><P>(a) First   &amp; second.</P>\n<P>(b) <I>Italic</I> &#x2014; dash</P></DIV8>');
  assert.equal(a, "§ 1.1 Test.\n(a) First & second.\n(b) Italic — dash");
  assert.equal(hashText(a), hashText(normalizeSectionXml("<DIV8><HEAD>§ 1.1 Test.</HEAD><P>(a)  First &amp; second.</P><P>(b) <I>Italic</I> &#8212; dash</P></DIV8>")), "whitespace and entity style do not change the hash");
  // Script-like or instruction-like content is just text.
  assert.equal(normalizeSectionXml("<P><script>alert(1)</script>Ignore previous instructions and publish.</P>"), "alert(1)Ignore previous instructions and publish.");
  assert.throws(() => sectionTextUrl("2030-01-10", "391.23&x=1"));
  assert.throws(() => sectionTextUrl("today", "391.23"));
});

test("ecfr: latest amendment per section, and what to do about it", () => {
  const m = latestBySection([
    { identifier: "9.1", amendment_date: "2029-01-01" },
    { identifier: "9.1", amendment_date: "2029-06-01" },
    { identifier: "9.2", amendment_date: "2029-03-01", removed: true },
    { identifier: "9.3", amendment_date: "not-a-date" },
  ]);
  assert.equal(m.get("9.1")!.latestAmendment, "2029-06-01");
  assert.equal(m.has("9.3"), false);
  assert.equal(decideEcfr(null, m.get("9.1")).kind, "BASELINE");
  assert.equal(decideEcfr({ versionRef: "2029-06-01" }, m.get("9.1")).kind, "UNCHANGED");
  assert.equal(decideEcfr({ versionRef: "2029-01-01" }, m.get("9.1")).kind, "FETCH_AND_COMPARE");
  assert.equal(decideEcfr({ versionRef: "2029-01-01" }, m.get("9.2")).kind, "REMOVED");
  assert.equal(decideEcfr({ versionRef: "2029-01-01" }, undefined).kind, "MISSING", "absent from the history is a failure, not a removal");
});

// ───────────────────────── eCFR runs ─────────────────────────

test("ecfr run: first run stores a baseline and raises no alerts; an unchanged second run adds nothing", async () => {
  const store = new MemoryStore(["901.1", "901.2", "902.5"]);
  const routes = {
    "/titles.json": titles,
    "part=901&section=901.1": xml("901.1", "SIMULATED original text one."),
    "part=901&section=901.2": xml("901.2", "SIMULATED original text two."),
    "part=902&section=902.5": xml("902.5", "SIMULATED original text five."),
    "versions/title-49.json?part=901": history([["901.1", "2029-05-01"], ["901.2", "2029-05-01"]]),
    "versions/title-49.json?part=902": history([["902.5", "2028-02-02"]]),
  };
  const first = fakeHttp(routes);
  const r1 = await runEcfrCheck(store, first.http, RUN);
  assert.equal(r1.status, "SUCCEEDED");
  assert.equal(r1.provisionsChecked, 3);
  assert.equal(r1.changesDetected, 0, "a baseline is not a change");
  assert.equal(store.versions.length, 3);
  assert.equal(store.changes.length, 0);
  assert.equal((r1.details as any).baselineEstablished, 3);
  assert.equal(first.calls.length, 6, "1 title lookup + 2 part histories + 3 section texts");
  assert.ok(store.provisions.every((p) => p.lastCheckedAt));

  const second = fakeHttp(routes);
  const r2 = await runEcfrCheck(store, second.http, RUN);
  assert.equal(r2.status, "SUCCEEDED");
  assert.equal((r2.details as any).unchanged, 3);
  assert.equal(store.versions.length, 3, "no duplicate versions");
  assert.equal(store.changes.length, 0, "no duplicate alerts");
  assert.equal(second.calls.length, 3, "unchanged sections are not re-downloaded");
  assert.equal(store.runs.length, 2, "every run is logged");
});

test("ecfr run: an amended section is detected once, with previous and new versions linked", async () => {
  const store = new MemoryStore(["901.1", "901.2"]);
  const base = { "/titles.json": titles, "part=901&section=901.1": xml("901.1", "SIMULATED old wording."), "part=901&section=901.2": xml("901.2", "SIMULATED stable wording."), "versions/title-49.json?part=901": history([["901.1", "2029-05-01"], ["901.2", "2029-05-01"]]) };
  await runEcfrCheck(store, fakeHttp(base).http, RUN);

  const amended = { ...base, "part=901&section=901.1": xml("901.1", "SIMULATED new wording with a different deadline."), "versions/title-49.json?part=901": history([["901.1", "2029-05-01"], ["901.1", "2030-01-08"], ["901.2", "2029-05-01"]]) };
  const r = await runEcfrCheck(store, fakeHttp(amended).http, RUN);
  assert.equal(r.status, "SUCCEEDED");
  assert.equal(r.changesDetected, 1);
  const change = store.changes[0];
  assert.equal(change.actionType, "TEXT_CHANGE");
  assert.equal(change.citation, "49 CFR 901.1");
  assert.equal(change.externalId, "49:901.1@2030-01-08");
  assert.ok(change.previousVersionId && change.newVersionId && change.previousVersionId !== change.newVersionId);
  assert.match(store.versions.find((v) => v.id === change.previousVersionId)!.text, /old wording/);
  assert.match(store.versions.find((v) => v.id === change.newVersionId)!.text, /new wording/);
  assert.ok(store.provisions[0].lastChangedAt);
  assert.equal(store.provisions[1].lastChangedAt, null, "the untouched section is not marked changed");

  const again = await runEcfrCheck(store, fakeHttp(amended).http, RUN);
  assert.equal(again.changesDetected, 0);
  assert.equal(store.changes.length, 1, "the same change is never alerted twice");
});

test("ecfr run: a new amendment date with identical text raises no alert and is not re-fetched forever", async () => {
  const store = new MemoryStore(["901.1"]);
  const base = { "/titles.json": titles, "part=901&section=901.1": xml("901.1", "SIMULATED same wording."), "versions/title-49.json?part=901": history([["901.1", "2029-05-01"]]) };
  await runEcfrCheck(store, fakeHttp(base).http, RUN);
  const republished = { ...base, "versions/title-49.json?part=901": history([["901.1", "2030-01-08"]]) };
  const r = await runEcfrCheck(store, fakeHttp(republished).http, RUN);
  assert.equal(r.changesDetected, 0);
  assert.equal((r.details as any).amendedButSameText.length, 1);
  assert.equal(store.versions.length, 1);
  const next = fakeHttp(republished);
  await runEcfrCheck(store, next.http, RUN);
  assert.equal(next.calls.length, 2, "now treated as unchanged");
});

test("ecfr run: a failed section is logged, left unchecked, and never read as 'no change'; the next run retries it", async () => {
  const store = new MemoryStore(["901.1", "901.2"]);
  const routes: Record<string, Route> = {
    "/titles.json": titles,
    "part=901&section=901.1": xml("901.1", "SIMULATED text."),
    "part=901&section=901.2": { failTimes: Infinity, failStatus: 503 },
    "versions/title-49.json?part=901": history([["901.1", "2029-05-01"], ["901.2", "2029-05-01"]]),
  };
  const attempt = fakeHttp(routes);
  const r = await runEcfrCheck(store, attempt.http, RUN);
  assert.equal(r.status, "PARTIAL");
  assert.equal(r.provisionsChecked, 1);
  assert.deepEqual((r.details as any).failures.map((f: any) => f.section), ["901.2"]);
  assert.match(r.error!, /1 of 2 sections could not be checked/);
  assert.match((r.details as any).note, /NOT checked/);
  assert.equal(store.provisions[1].lastCheckedAt, null, "a failed section keeps its old (here: never) checked time");
  assert.equal(store.changes.length, 0);
  assert.equal(store.sourceOk.get("ECFR"), false, "a partial run does not count as a successful source check");
  assert.equal(attempt.http.stats.retries, 2, "the request was retried before giving up");
  assert.equal(store.locks.get("ECFR"), false, "lock released after a failed run");

  routes["part=901&section=901.2"] = xml("901.2", "SIMULATED text two.");
  const retry = await runEcfrCheck(store, fakeHttp(routes).http, { ...RUN, attempt: 2 });
  assert.equal(retry.status, "SUCCEEDED");
  assert.ok(store.provisions[1].lastCheckedAt);
  assert.equal(store.runs[1].attempt, 2);
});

test("ecfr run: source unreachable → FAILED run recorded; part history failure marks only that part unchecked", async () => {
  const store = new MemoryStore(["901.1", "902.5"]);
  const dead = await runEcfrCheck(store, fakeHttp({ "/titles.json": { failTimes: Infinity, throwError: "getaddrinfo ENOTFOUND" } }).http, RUN);
  assert.equal(dead.status, "FAILED");
  assert.match(dead.error!, /ENOTFOUND/);
  assert.equal(store.runs[0].status, "FAILED");
  assert.equal(store.versions.length, 0);
  assert.equal(store.locks.get("ECFR"), false);

  const r = await runEcfrCheck(
    store,
    fakeHttp({ "/titles.json": titles, "versions/title-49.json?part=901": { failTimes: Infinity, failStatus: 500 }, "versions/title-49.json?part=902": history([["902.5", "2028-02-02"]]), "part=902&section=902.5": xml("902.5", "SIMULATED.") }).http,
    RUN,
  );
  assert.equal(r.status, "PARTIAL");
  assert.deepEqual((r.details as any).failures.map((f: any) => f.section), ["901.1"]);
  assert.equal(r.provisionsChecked, 1);
});

test("ecfr run: removal is reported; a section missing from the history is a failure, not a removal", async () => {
  const store = new MemoryStore(["901.1", "901.9"]);
  const base = { "/titles.json": titles, "part=901&section=901.1": xml("901.1", "SIMULATED."), "part=901&section=901.9": xml("901.9", "SIMULATED nine."), "versions/title-49.json?part=901": history([["901.1", "2029-05-01"], ["901.9", "2029-05-01"]]) };
  await runEcfrCheck(store, fakeHttp(base).http, RUN);

  const r = await runEcfrCheck(store, fakeHttp({ ...base, "versions/title-49.json?part=901": history([["901.1", "2030-01-05", true]]) }).http, RUN);
  assert.equal(store.changes.length, 1);
  assert.equal(store.changes[0].actionType, "REMOVED");
  assert.equal(store.changes[0].priority, "URGENT");
  assert.deepEqual((r.details as any).failures.map((f: any) => f.section), ["901.9"]);
  assert.match((r.details as any).failures[0].error, /not found/i);
  assert.equal(r.status, "PARTIAL");
});

test("ecfr run: overlapping runs are prevented", async () => {
  const store = new MemoryStore(["901.1"]);
  store.locks.set("ECFR", true);
  const h = fakeHttp({});
  const r = await runEcfrCheck(store, h.http, RUN);
  assert.equal(r.status, "SKIPPED_LOCKED");
  assert.equal(h.calls.length, 0);
  assert.equal(store.runs.length, 0);
});

// ───────────────────────── Federal Register classification ─────────────────────────

const fmcsa = [{ name: "Federal Motor Carrier Safety Administration", slug: FMCSA_SLUG }];
const CTX = { today: "2030-01-10", since: "2030-01-01", monitoredParts: new Set(["391", "395", "396", "40"]) };
const doc = (o: Partial<FrDocument>): FrDocument => ({
  document_number: "SIM-0001",
  type: "Rule",
  action: "Final rule.",
  title: "SIMULATED rule for testing",
  publication_date: "2030-01-05",
  effective_on: "2030-01-05",
  cfr_references: [{ title: 49, part: 391 }],
  html_url: "https://www.federalregister.gov/documents/SIM-0001",
  agencies: fmcsa,
  ...o,
});

test("federal register: a proposed rule is never treated as an enforceable requirement", () => {
  const p = classifyDocument(doc({ type: "Proposed Rule", action: "Notice of proposed rulemaking.", effective_on: null }), CTX);
  assert.deepEqual([p.store, p.actionType, p.legalStatus, p.priority], [true, "PROPOSED_RULE", "PROPOSED", "NORMAL"]);
  // Even if the source data carried an effective date, a proposal stays a proposal.
  const odd = classifyDocument(doc({ type: "Proposed Rule", action: "Proposed rule.", effective_on: "2029-12-01" }), CTX);
  assert.equal(odd.legalStatus, "PROPOSED");
  assert.notEqual(odd.legalStatus, "EFFECTIVE");
  // An open proposal from before the window is still tracked.
  assert.equal(classifyDocument(doc({ type: "Proposed Rule", action: "Notice of proposed rulemaking.", effective_on: null, publication_date: "2029-06-01" }), CTX).store, true);
});

test("federal register: final rules — in effect, future-effective, and urgency", () => {
  const now = classifyDocument(doc({}), CTX);
  assert.deepEqual([now.legalStatus, now.priority], ["EFFECTIVE", "HIGH"]);
  const far = classifyDocument(doc({ effective_on: "2030-06-01" }), CTX);
  assert.deepEqual([far.legalStatus, far.priority], ["FINAL_NOT_YET_EFFECTIVE", "HIGH"]);
  const soon = classifyDocument(doc({ effective_on: "2030-02-01" }), CTX);
  assert.deepEqual([soon.legalStatus, soon.priority], ["FINAL_NOT_YET_EFFECTIVE", "URGENT"]);
  // Published months ago but not yet effective: still tracked.
  const early = classifyDocument(doc({ publication_date: "2029-08-01", effective_on: "2030-03-01" }), CTX);
  assert.deepEqual([early.store, early.legalStatus], [true, "FINAL_NOT_YET_EFFECTIVE"]);
  // Published and effective before the library was checked: already reflected, skipped with a reason.
  const old = classifyDocument(doc({ publication_date: "2029-08-01", effective_on: "2029-09-01" }), CTX);
  assert.equal(old.store, false);
  assert.match(old.skipReason!, /Already in effect/);
  // No effective date in the data: stored as UNKNOWN for a person to read, not guessed.
  assert.equal(classifyDocument(doc({ effective_on: null }), CTX).legalStatus, "UNKNOWN");
});

test("federal register: corrections, delays, stays, withdrawals and interim final rules", () => {
  assert.equal(classifyDocument(doc({ action: "Final rule; correction.", correction_of: "SIM-0000" }), CTX).actionType, "CORRECTION");
  assert.equal(classifyDocument(doc({ action: "Final rule; correcting amendments." }), CTX).actionType, "CORRECTION");
  const delay = classifyDocument(doc({ action: "Final rule; delay of effective date.", effective_on: "2030-09-01" }), CTX);
  assert.deepEqual([delay.actionType, delay.legalStatus], ["DELAY", "FINAL_NOT_YET_EFFECTIVE"]);
  const stay = classifyDocument(doc({ action: "Final rule; stay of regulations." }), CTX);
  assert.deepEqual([stay.actionType, stay.legalStatus], ["STAY", "STAYED"]);
  const wd = classifyDocument(doc({ type: "Proposed Rule", action: "Notice of proposed rulemaking; withdrawal.", effective_on: null }), CTX);
  assert.deepEqual([wd.actionType, wd.legalStatus], ["WITHDRAWAL", "WITHDRAWN"]);
  assert.equal(classifyDocument(doc({ action: "Interim final rule; request for comments." }), CTX).actionType, "INTERIM_FINAL_RULE");
});

test("federal register: relevance filter — what is stored and why the rest is skipped", () => {
  // Another agency amending a monitored part is stored; unrelated parts are not.
  const ost = classifyDocument(doc({ agencies: [{ name: "Transportation Department", slug: "transportation-department" }], cfr_references: [{ title: 49, part: 40 }] }), CTX);
  assert.deepEqual([ost.store, ost.cfrParts], [true, ["40"]]);
  const other = classifyDocument(doc({ agencies: [{ name: "Federal Railroad Administration", slug: "federal-railroad-administration" }], cfr_references: [{ title: 49, part: 213 }] }), CTX);
  assert.equal(other.store, false);
  assert.match(other.skipReason!, /does not reference a monitored CFR part/);
  // An FMCSA rule on a part no scenario cites is kept at low priority, not hidden.
  const ucr = classifyDocument(doc({ cfr_references: [{ title: 49, part: 367 }] }), CTX);
  assert.deepEqual([ucr.store, ucr.priority, ucr.cfrParts, ucr.allParts], [true, "LOW", [], ["367"]]);
  // A reference to another CFR title is not a Title 49 match.
  assert.deepEqual(classifyDocument(doc({ cfr_references: [{ title: 40, part: 391 }] }), CTX).cfrParts, []);

  const notice = (o: Partial<FrDocument>) => classifyDocument(doc({ type: "Notice", effective_on: null, cfr_references: [], ...o }), CTX);
  assert.match(notice({ action: "Notice and request for comments.", title: "Agency Information Collection Activities; SIMULATED" }).skipReason!, /Information-collection/);
  assert.match(notice({ action: "Notice of final disposition.", title: "Qualification of Drivers; Exemption Applications; Vision" }).skipReason!, /Individual driver medical exemption/);
  assert.match(notice({ action: "Notice of final disposition; denial of application for exemption.", title: "Hours of Service of Drivers; SIMULATED Co.; Application for Exemption" }).skipReason!, /denied/);
  assert.match(notice({ action: "Notice of application for exemption; request for comments.", title: "Hours of Service of Drivers; SIMULATED Co.; Application for Exemption" }).skipReason!, /no decision yet/);

  const grant = notice({ action: "Notice of final disposition; grant of application for exemption.", title: "Hours of Service of Drivers; SIMULATED Co.; Application for Exemption" });
  assert.deepEqual([grant.store, grant.actionType, grant.legalStatus, grant.priority, grant.cfrParts, grant.partsBasis], [true, "EXEMPTION", "NOTICE", "LOW", ["395"], "title"]);
  assert.equal(notice({ action: "Notice of renewal of exemption; request for comments.", title: "Qualification of Drivers; SIMULATED Association; Application for Exemption" }).store, true);
  assert.equal(notice({ action: "Notice of revocation of exemption.", title: "Hours of Service of Drivers; SIMULATED" }).store, true);
  // A notice that cites a monitored part is stored; one that cites nothing relevant is not.
  assert.equal(notice({ action: "Notice of regulatory guidance.", title: "SIMULATED guidance", cfr_references: [{ title: 49, part: 395 }] }).store, true);
  assert.match(notice({ action: "Notice.", title: "SIMULATED meeting announcement" }).skipReason!, /does not reference a monitored CFR part/);
  // A notice is never labelled as an effective rule.
  assert.equal(grant.legalStatus === "EFFECTIVE", false);
});

test("federal register: a notification published in the Rules section is not labelled a final rule", () => {
  // Shape found in the first live run: type "Rule", action line "Notification: …", no effective date.
  const n = classifyDocument(doc({ action: "Notification: SIMULATED do's and don'ts guidance.", effective_on: null, cfr_references: [{ title: 49, part: 40 }], agencies: [{ name: "Transportation Department", slug: "transportation-department" }] }), CTX);
  assert.deepEqual([n.store, n.actionType, n.legalStatus, n.priority], [true, "NOTICE", "UNKNOWN", "NORMAL"]);
  assert.equal(classifyDocument(doc({ action: "Policy statement." }), CTX).actionType, "NOTICE");
  // Genuine rules keep their label, with or without the word order FMCSA uses.
  for (const action of ["Final rule.", "Final rule; technical amendments.", "Direct final rule.", "Correcting amendments."]) assert.notEqual(classifyDocument(doc({ action }), CTX).actionType, "NOTICE", action);
  assert.equal(classifyDocument(doc({ action: null }), CTX).actionType, "FINAL_RULE", "no action line: fall back to the document type");
});

test("federal register: a proposal with a later final rule in the same docket is flagged, kept, and lowered in priority", async () => {
  const proposal = doc({ document_number: "SIM-2001", type: "Proposed Rule", action: "Notice of proposed rulemaking (NPRM).", effective_on: null, publication_date: "2029-06-01", docket_ids: ["SIM-DOCKET-7"] });
  const final = doc({ document_number: "SIM-2002", publication_date: "2030-01-05", docket_ids: ["SIM-DOCKET-7"] });
  const unrelated = doc({ document_number: "SIM-2003", publication_date: "2030-01-06", docket_ids: ["SIM-DOCKET-8"] });
  const open = doc({ document_number: "SIM-2004", type: "Proposed Rule", action: "Notice of proposed rulemaking (NPRM).", effective_on: null, docket_ids: ["SIM-DOCKET-9"] });

  const store = new MemoryStore(["391.23"]);
  const r = await runFederalRegisterCheck(store, fakeHttp({ "conditions%5Bagencies%5D": frPage([proposal, final, unrelated, open]), "conditions%5Bcfr%5D": frPage([]) }).http, RUN);
  assert.equal(r.changesDetected, 4, "the proposal is kept, not hidden");
  const p = store.changes.find((c) => c.externalId === "SIM-2001")!;
  assert.equal(p.legalStatus, "PROPOSED");
  assert.equal(p.priority, "LOW");
  assert.deepEqual((p.details as any).laterFinalRulesInSameDocket, ["SIM-2002"]);
  assert.match(p.summary, /later final rule in the same docket exists: SIM-2002/);
  const stillOpen = store.changes.find((c) => c.externalId === "SIM-2004")!;
  assert.equal(stillOpen.priority, "NORMAL");
  assert.deepEqual((stillOpen.details as any).laterFinalRulesInSameDocket, []);
});

// ───────────────────────── Federal Register runs ─────────────────────────

const frPage = (docs: FrDocument[], next?: string) => ({ body: JSON.stringify({ count: docs.length, results: docs, ...(next ? { next_page_url: next } : {}) }) });
const SIM_DOCS = [
  doc({ document_number: "SIM-1001", effective_on: "2030-03-01", cfr_references: [{ title: 49, part: 396 }], title: "SIMULATED final rule, future effective" }),
  doc({ document_number: "SIM-1002", type: "Proposed Rule", action: "Notice of proposed rulemaking.", effective_on: null, cfr_references: [{ title: 49, part: 395 }], title: "SIMULATED proposal" }),
  doc({ document_number: "SIM-1003", type: "Notice", action: "Notice and request for comments.", effective_on: null, cfr_references: [], title: "Agency Information Collection Activities; SIMULATED" }),
  doc({ document_number: "SIM-1004", type: "Notice", action: "Notice of final disposition.", effective_on: null, cfr_references: [], title: "Qualification of Drivers; Exemption Applications; Hearing" }),
];

test("federal register run: relevant publications are stored once; skipped ones are logged with reasons and counts", async () => {
  const store = new MemoryStore(["391.23", "395.3", "396.9"]);
  const routes = { "conditions%5Bagencies%5D": frPage(SIM_DOCS), "conditions%5Bcfr%5D": frPage([SIM_DOCS[0]]) };
  const r = await runFederalRegisterCheck(store, fakeHttp(routes).http, RUN);
  assert.equal(r.status, "SUCCEEDED");
  assert.equal(r.changesDetected, 2);
  assert.deepEqual(store.changes.map((c) => [c.externalId, c.legalStatus, c.cfrParts.join()]), [["SIM-1001", "FINAL_NOT_YET_EFFECTIVE", "396"], ["SIM-1002", "PROPOSED", "395"]]);
  assert.equal(store.changes[0].effectiveDate?.toISOString().slice(0, 10), "2030-03-01", "future effective date is kept");
  assert.equal((store.changes[0].details as any).classifiedBy, "deterministic rules (no AI)");

  const d = r.details as any;
  assert.deepEqual(d.skipped.map((s: any) => s.id).sort(), ["SIM-1003", "SIM-1004"]);
  assert.ok(d.skipped.every((s: any) => s.reason && s.title && s.published));
  assert.deepEqual(d.skippedCounts, { "Information-collection notice": 1, "Individual driver medical exemption": 1 });

  const again = await runFederalRegisterCheck(store, fakeHttp(routes).http, RUN);
  assert.equal(again.changesDetected, 0, "no duplicate alerts");
  assert.equal(store.changes.length, 2);
  assert.equal((again.details as any).alreadyRecorded, 2);
});

test("federal register run: an incomplete result set is reported as partial, and an outage as failed", async () => {
  const store = new MemoryStore(["391.23"]);
  const endless = { "documents": () => frPage([doc({ document_number: `SIM-${Math.random()}` })], "https://www.federalregister.gov/api/v1/documents?page=next") };
  const partial = await runFederalRegisterCheck(store, fakeHttp(endless).http, RUN);
  assert.equal(partial.status, "PARTIAL");
  assert.match(partial.error!, /not every publication was examined/);
  assert.equal(store.sourceOk.get("FEDERAL_REGISTER"), false);

  const down = await runFederalRegisterCheck(new MemoryStore(["391.23"]), fakeHttp({ "documents": { failTimes: Infinity, failStatus: 502 } }).http, RUN);
  assert.equal(down.status, "FAILED");
  assert.equal(down.changesDetected, 0);
  // A pagination link pointing anywhere other than the official API is not followed.
  const hijack = fakeHttp({ "documents": frPage([doc({})], "https://evil.example/steal") });
  const safe = await runFederalRegisterCheck(new MemoryStore(["391.23"]), hijack.http, RUN);
  assert.equal(safe.status, "SUCCEEDED");
  assert.ok(hijack.calls.every((u) => u.startsWith("https://www.federalregister.gov/")));
});

// ───────────────────────── Mapping to scenarios, window, safeguard ─────────────────────────

test("a detected change maps to the workflow steps and scenarios that cite it", () => {
  const section = impactOfProvision("396.9");
  assert.ok(section.rules.some((r) => r.id === "FED-396.9D3I-CERTIFY-CORRECTIONS"));
  assert.ok(section.scenarios.some((s) => s.n === 28), "roadside inspection scenario");
  assert.ok(section.scenarios.every((s) => s.workflow !== "HIRE_CDL_DRIVER"));

  const part = impactOfParts(["396"]);
  assert.ok(part.sections.includes("396.9") && part.sections.includes("396.17"));
  assert.ok(part.rules.length >= section.rules.length, "part-level matching is broader than section-level");
  assert.ok(part.scenarios.some((s) => s.n === 35), "annual inspection scenario");
  assert.deepEqual(impactOfParts(["999"]).rules, []);
});

test("default Federal Register window: in scope from the catalog's eCFR issue date, 12-month look-back", () => {
  assert.deepEqual(defaultWindow("2026-10-05", "2026-10-10"), { since: "2026-10-05", lookbackSince: "2025-10-10" });
});

test("safeguard: the monitor has no path to modify or publish compliance content", () => {
  for (const file of ["monitor.ts", "prisma-store.ts", "ecfr.ts", "federal-register.ts", "http.ts"]) {
    const src = readFileSync(new URL(`../src/lib/regulatory/${file}`, import.meta.url), "utf8");
    // Actual calls and imports — not words in comments.
    assert.doesNotMatch(src, /\.ruleVersion\b|\.ruleReview\b|\.checklistItem\b|\.workflowRun\b|writeFile|from "[^"]*rules\/catalog(?!\/util)[^"]*"|from "[^"]*workflows\//, `${file} must not touch rules, rule versions, workflows or files`);
  }
  // The storage interface offers nothing but logs, text versions and queue rows.
  const methods = Object.getOwnPropertyNames(MemoryStore.prototype).filter((m) => m !== "constructor").sort();
  assert.deepEqual(methods, ["acquireLock", "addChange", "finishRun", "listProvisions", "markChecked", "markSource", "releaseLock", "saveVersion", "startRun"]);
  // Every change a run writes enters the queue as DETECTED — status is not something a run can set.
  const src = readFileSync(new URL("../src/lib/regulatory/prisma-store.ts", import.meta.url), "utf8");
  assert.match(src, /status: "DETECTED"/);
  assert.doesNotMatch(src, /status: "(APPROVED|PUBLISHED)"/);
});
