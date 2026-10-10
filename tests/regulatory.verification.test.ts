import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_RULES, rulesFor } from "../src/lib/rules/catalog";
import { ecfr } from "../src/lib/rules/catalog/util";
import type { RegulatoryRule } from "../src/lib/rules/types";
import { PlatformAdminRequiredError } from "../src/lib/auth/rbac";
import { applicabilityStatus, contentReview, CONTENT_REVIEW_LABELS } from "../src/lib/rules/content-review";
import { generateChecklist } from "../src/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "../src/lib/workflows/definitions";
import { hashText, type SectionStatus } from "../src/lib/regulatory/ecfr";
import { changeRelevance, citationGroup, openFindings, sectionsMentioned } from "../src/lib/regulatory/findings";
import { planSync } from "../src/lib/regulatory/sync";
import { buildDependencyMap } from "../src/lib/regulatory/dependencies";
import {
  APPROVE_CONFIRMATION,
  PUBLISH_CONFIRMATION,
  VERIFICATION_STATUSES,
  VerificationError,
  applyOverrides,
  assignReviewer,
  buildQueue,
  createMemoryVerificationStore,
  currentFindings,
  draftCitationRepair,
  flagReverification,
  initialStatus,
  monitorCoverage,
  proposeCitationRepair,
  reviewFinding,
  offlineFindings,
  previewPublication,
  publishCorrection,
  publishedOverrides,
  queuePriority,
  recordDecision,
  runSourceCheck,
  saveProposedCorrection,
  validateCorrection,
  wordingOf,
  type Actor,
  type DetectedChange,
  type SourceFetcher,
  type Wording,
} from "../src/lib/regulatory/verification";

// All regulatory text and change records in this file are SIMULATED fixtures (marked SIM). No test
// contacts an official source, and no test result is evidence about what a regulation says.

const ADMIN: Actor = { id: "admin_1", orgId: "org_platform", platformAdmin: true };
const OWNER: Actor = { id: "owner_1", orgId: "org_customer", platformAdmin: false }; // a customer Owner is not an administrator
const EXEMPTION = "REVIEW-CLAIMED-EXEMPTION";
const exemptionRule = ALL_RULES.find((r) => r.id === EXEMPTION)!;
const DRAFT = (JSON.parse(readFileSync("docs/verification-drafts/REVIEW-CLAIMED-EXEMPTION.json", "utf8")) as { wording: Wording }).wording;

/** Simulated eCFR: a section list per part and text per section. */
function fakeEcfr(opts: { issue?: string; removed?: string[]; reserved?: string[]; missing?: string[]; amended?: Record<string, string>; failText?: string[]; down?: boolean } = {}) {
  let requests = 0;
  const sectionsOf: Record<string, string[]> = {
    "391": ["391.1", "391.2", "391.11", "391.21", "391.23", "391.61", "391.62", "391.63", "391.64", "391.65", "391.67", "391.68", "391.69", "391.71"],
    "383": ["383.1", "383.3", "383.23", "383.51"],
    "382": ["382.103", "382.301"],
    "395": ["395.1", "395.3"],
    "390": ["390.3", "390.5"],
  };
  const subpartOf = (s: string) => (/^391\.(6\d|71)$/.test(s) ? "G" : /^391\.(2\d|3\d)$/.test(s) ? "C" : null);
  const reserved = new Set(["391.64", "391.71", ...(opts.reserved ?? [])]);
  const fetcher: SourceFetcher = {
    async latestIssueDate() {
      requests++;
      if (opts.down) throw new Error("SIM: eCFR unavailable");
      return opts.issue ?? "2026-10-08";
    },
    async partStatus(part) {
      requests++;
      const map = new Map<string, SectionStatus>();
      for (const s of sectionsOf[part] ?? [])
        if (!opts.missing?.includes(s))
          map.set(s, { section: s, latestAmendment: opts.amended?.[s] ?? "2020-01-01", heading: reserved.has(s) ? `§ ${s} [Reserved]` : `§ ${s} SIM heading`, removed: !!opts.removed?.includes(s), subpart: subpartOf(s) });
      return map;
    },
    async sectionText(issue, section) {
      requests++;
      if (opts.failText?.includes(section)) throw new Error("SIM: timeout");
      if (reserved.has(section)) throw new Error("SIM: no text");
      const text = `SIM text of § ${section} as of ${issue}. `.repeat(8);
      return { text, hash: hashText(text), url: `https://www.ecfr.gov/api/versioner/v1/full/${issue}/title-49.xml?part=${section.split(".")[0]}&section=${section}` };
    },
    requests: () => requests,
  };
  return fetcher;
}

/** A small stand-in catalog rule, so each citation case is isolated. */
const stepWith = (id: string, sources: RegulatoryRule["sources"], patch: Partial<RegulatoryRule> = {}): RegulatoryRule => ({
  ...exemptionRule, id, title: "SIM step", requiredAction: ["Do the SIM thing."], sources, blocksSafetySensitive: false, workflows: ["HIRE_CDL_DRIVER"], ...patch,
});
const catalogWith = (...extra: RegulatoryRule[]) => [...ALL_RULES, ...extra];

// ───────────────────────── The queue ─────────────────────────

test("queue: every flagged step is listed with one of the seven statuses, safety-sensitive and suspect items first", () => {
  const queue = buildQueue([], []);
  const flagged = ALL_RULES.filter((r) => r.verificationStatus === "REQUIRES_VERIFICATION");
  assert.equal(queue.length, flagged.length);
  assert.equal(queue.length, 38);
  for (const i of queue) {
    assert.ok(VERIFICATION_STATUSES.includes(i.status));
    assert.ok(["NOT_REVIEWED", "REVIEW_REQUIRED"].includes(i.status), `${i.rule.id}: nothing is reviewed until an administrator says so`);
    assert.equal(i.status, initialStatus(i.rule));
    assert.ok(i.rule.verificationNote, "the reason review is needed is shown");
  }
  const levels = queue.map((i) => ["HIGHEST", "HIGH", "NORMAL", "LOW"].indexOf(i.priority.level));
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), "ordered by priority");
  assert.ok(queue.filter((i) => i.safetySensitive).every((i) => i.priority.level === "HIGHEST" && i.status === "REVIEW_REQUIRED"));

  const ex = queue.find((i) => i.rule.id === EXEMPTION)!;
  assert.equal(ex.priority.level, "HIGHEST");
  assert.ok(ex.safetySensitive && ex.exemption);
  assert.ok(ex.priority.reasons.includes("Exemption claim") && ex.priority.reasons.includes("Possible citation problem"));
  assert.ok(ex.scenarios.some((s) => s.href.startsWith("/guide/hire-cdl-driver")), "links to the affected workflow");
  assert.equal(ex.lastChecked, null, "never checked");
});

test("queue priority organizes reviews; it never marks anything correct", () => {
  const routine = stepWith("SIM-ROUTINE", [{ citation: "State law (varies)", url: "https://www.fmcsa.dot.gov/registration" }], { title: "File the SIM form", recordCategory: "COMPANY_RECORDS", deadline: { description: "State-specific." } });
  const p = queuePriority(routine, offlineFindings(routine, catalogWith(routine)));
  assert.ok(["LOW", "NORMAL"].includes(p.level));
  assert.equal(initialStatus(routine, catalogWith(routine)), "NOT_REVIEWED");
  const oos = stepWith("SIM-OOS", [ecfr("383.51")], { prohibits: "Driving a CMV" });
  assert.equal(queuePriority(oos, []).level, "HIGHEST");
  assert.equal(initialStatus(oos, catalogWith(oos)), "REVIEW_REQUIRED");
});

// ───────────────────────── The exemption test case ─────────────────────────

test("exemption step: the checks ask whether it cites where Parts 383 and 382 set out their own exceptions, and flag the one-section link", () => {
  const f = offlineFindings(exemptionRule);
  const scope = f.filter((x) => x.code === "EXEMPTION_SCOPE");
  assert.deepEqual(scope.map((x) => x.key).sort(), ["EXEMPTION_SCOPE|382", "EXEMPTION_SCOPE|383"], "Part 391's own exceptions are cited; those of Parts 383 and 382 are not");
  for (const x of scope) {
    assert.equal(x.severity, "POSSIBLE", "raised for a person to decide — not asserted as wrong");
    assert.equal(x.appliesTo, "CURRENT");
    assert.ok(x.explanation.length > 40 && x.nextAction.length > 40, "explained, with a recommended next action");
    assert.match(x.sources[0].url, /^https:\/\/www\.ecfr\.gov\/current\/title-49\/section-38[23]\./, "links the official section involved");
  }
  assert.match(scope.find((x) => x.key.endsWith("383"))!.message, /§ 383\.3.*CDL licensing/);
  assert.match(scope.find((x) => x.key.endsWith("382"))!.message, /§ 382\.103.*drug and alcohol testing/);
  assert.ok(!f.some((x) => /Part (40|172|380)\b/.test(x.message)), "parts that have nothing to do with exemptions are no longer listed");
  const range = f.find((x) => x.code === "RANGE_COVERED_BY_ONE_LINK")!;
  assert.equal(range.severity, "POSSIBLE");
  assert.match(range.message, /§§ 391\.61–391\.69.*opens only § 391\.61/);
  assert.ok(!f.some((x) => x.severity === "PROBLEM"), "nothing is declared incorrect by keyword matching");
});
test("exemption step: the prepared correction is valid, cites Parts 391 and 383 section by section, and states eligibility conditions and documents", () => {
  assert.deepEqual(validateCorrection(DRAFT), {});
  const cited = DRAFT.sources.map((s) => s.citation);
  for (const c of ["49 CFR 391.2", "49 CFR 391.61", "49 CFR 391.69", "49 CFR 383.3", "49 CFR 382.103"]) assert.ok(cited.includes(c), c);
  assert.ok(!cited.some((c) => /391\.64|391\.71/.test(c)), "reserved sections are not cited");
  const text = DRAFT.requiredAction.join(" ");
  assert.match(text, /Nothing in Subpart G exempts a driver from holding a commercial driver’s license/);
  assert.match(text, /383\.3/);
  assert.match(text, /meet every condition/);
  assert.match(text, /Do not mark CDL items or drug and alcohol testing items Not Applicable on the strength of a Part 391 exemption/);
  assert.match(text, /Drug and alcohol testing follows the CDL rules, not Part 391/);
  assert.match(text, /§ 382\.103\(d\)/);
  assert.ok(DRAFT.documentation.length >= 3, "supporting documentation is listed");
  assert.match(DRAFT.exceptions, /Not read for this entry/, "what was not read is said, not assumed");
  // With the correction, every regime's own exception section is cited: what remains concerns the current wording only.
  const after = offlineFindings(exemptionRule, ALL_RULES, DRAFT);
  assert.ok(after.filter((x) => x.severity !== "INFO").every((x) => x.appliesTo === "CURRENT"), "no open finding applies to the proposed correction");
  assert.deepEqual(after.filter((x) => x.appliesTo !== "CURRENT"), []);
  assert.match(DRAFT.exceptions, /snow and ice removal/, "the unresolved applicability question is stated, not decided");
});

test("exemption step: complete approval-to-publication flow, with nothing changing for customers until publication", async () => {
  const { store, reviews, versions, audits } = createMemoryVerificationStore();
  const served = async () => applyOverrides(rulesFor("HIRE_CDL_DRIVER"), publishedOverrides(ALL_RULES, await store.listCorrectionVersions(), await store.listStates())).find((r) => r.id === EXEMPTION)!;

  // 1. Draft correction loaded (as the command-line helper does) — a draft, attributed as such.
  let state = await saveProposedCorrection(store, ADMIN, EXEMPTION, DRAFT, { proposedBy: "system-draft" });
  assert.equal(state.status, "REVIEW_REQUIRED");
  assert.equal(state.proposedBy, "system-draft");
  assert.equal((await served()).title, exemptionRule.title, "a draft is not shown to customers");

  // 2. Approval is refused before the official sources have been retrieved.
  await assert.rejects(recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "Looks right to me, approving now.", confirmation: APPROVE_CONFIRMATION }), /Check Official Sources/);

  // 3. Source check: current citation and every section of the correction, including the range.
  const check = await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION, { now: new Date("2026-10-11T10:00:00Z") });
  assert.equal(check.outcome, "RETRIEVED");
  assert.equal(check.issueDate, "2026-10-08");
  const got = check.sections.map((s) => s.section);
  for (const s of ["382.103", "383.3", "391.2", "391.61", "391.62", "391.63", "391.64", "391.65", "391.67", "391.68", "391.69"]) assert.ok(got.includes(s), s);
  assert.ok(!got.includes("391.71"), "outside the cited range");
  const reserved = check.sections.find((s) => s.section === "391.64")!;
  assert.ok(reserved.reserved && !reserved.textHash);
  assert.equal(check.findings.find((f) => f.code === "SECTION_RESERVED")!.severity, "INFO", "a reserved section inside a cited range is noted, not an error");
  const one = check.sections.find((s) => s.section === "383.3")!;
  assert.equal(one.origin, "PROPOSED");
  assert.equal(one.officialUrl, "https://www.ecfr.gov/current/title-49/section-383.3");
  assert.ok(one.exists && one.excerpt && one.textHash && one.retrievedAt && one.lastAmended);
  state = (await store.getState(EXEMPTION))!;
  assert.equal(state.status, "SOURCE_CHECKED", "retrieval moves the item forward in the queue…");
  assert.equal(reviews.length, 0, "…but records no review and approves nothing");
  assert.equal((await served()).verificationStatus, "REQUIRES_VERIFICATION");

  // 4. Approval needs a note and a typed confirmation, and only an administrator can give it.
  await assert.rejects(recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "ok", confirmation: APPROVE_CONFIRMATION }), VerificationError);
  await assert.rejects(recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "Read 391.2, Subpart G and 383.3 in full." }), /Type APPROVE/);
  await assert.rejects(recordDecision(store, OWNER, EXEMPTION, { decision: "APPROVE", note: "Read 391.2, Subpart G and 383.3 in full.", confirmation: APPROVE_CONFIRMATION }), PlatformAdminRequiredError);
  const approved = await recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "SIM: read §§ 391.2, 391.61–391.69 and 383.3 in full; the correction states them accurately.", confirmation: APPROVE_CONFIRMATION, sources: ["https://www.fmcsa.dot.gov/registration/commercial-drivers-license"] }, { now: new Date("2026-10-11T11:00:00Z") });
  assert.equal(approved.state.status, "APPROVED_AWAITING_PUBLICATION");
  assert.equal(approved.review.outcome, "APPROVED");
  assert.equal(approved.review.reviewerId, ADMIN.id);
  assert.equal(approved.review.regulatoryVersion, "2026-10-08");
  assert.deepEqual(approved.review.previousWording, wordingOf(exemptionRule));
  assert.equal(approved.review.updatedWording!.title, DRAFT.title);
  assert.ok(approved.review.sources.includes("https://www.ecfr.gov/current/title-49/section-383.3") && approved.review.sources.includes("https://www.fmcsa.dot.gov/registration/commercial-drivers-license"));
  assert.equal(approved.review.claim!.title, exemptionRule.title, "the claim reviewed is recorded as it stood");
  assert.equal((await served()).title, exemptionRule.title, "approval alone changes nothing customers see");
  assert.equal(versions.length, 0);

  // 5. Publication is a separate confirmed action and shows original, replacement, citations and notes first.
  const preview = await previewPublication(store, ADMIN, EXEMPTION);
  assert.equal(preview.original.title, exemptionRule.title);
  assert.equal(preview.replacement.title, DRAFT.title);
  assert.ok(preview.changedFields.includes("sources") && preview.changedFields.includes("requiredAction"));
  assert.match(preview.review.note!, /read §§ 391\.2/);
  assert.equal(preview.toVersion, exemptionRule.version + 1);
  await assert.rejects(publishCorrection(store, ADMIN, EXEMPTION, "yes"), /Type PUBLISH/);
  await assert.rejects(publishCorrection(store, OWNER, EXEMPTION, PUBLISH_CONFIRMATION), PlatformAdminRequiredError);
  assert.equal(versions.length, 0);

  const { published, state: done } = await publishCorrection(store, ADMIN, EXEMPTION, PUBLISH_CONFIRMATION, { now: new Date("2026-10-11T12:00:00Z") });
  assert.equal(done.status, "REVIEWED_PUBLISHED");
  assert.equal(published.version, exemptionRule.version + 1);
  assert.equal(published.verificationStatus, "VERIFIED");
  assert.equal(published.humanReview!.reviewId, approved.review.id);
  assert.equal(published.verificationNote, undefined);
  // Wording and citations changed; the decision logic did not.
  assert.deepEqual(published.appliesWhen, exemptionRule.appliesWhen);
  assert.equal(published.blocksSafetySensitive, exemptionRule.blocksSafetySensitive);
  assert.deepEqual(published.deadline, exemptionRule.deadline);
  assert.equal(published.changeLog.length, exemptionRule.changeLog.length + 1);

  const live = await served();
  assert.equal(live.title, DRAFT.title, "customers now get the published version");
  assert.equal(contentReview(live).state, "REVIEWED");
  assert.equal(contentReview(live).label, CONTENT_REVIEW_LABELS.reviewed);
  assert.doesNotMatch(contentReview(live).detail + contentReview(live).label, /compliant/i);
  assert.equal(exemptionRule.title, "Review the claimed regulatory exemption", "the catalog's original version is untouched");

  // History is complete and append-only.
  assert.deepEqual(reviews.map((r) => r.outcome), ["APPROVED", "PUBLISHED"]);
  assert.equal(reviews[1].previousWording!.title, exemptionRule.title);
  assert.equal(reviews[1].updatedWording!.title, DRAFT.title);
  assert.deepEqual(audits.map((a) => a.action), ["verification.correction_saved", "verification.source_check", "verification.decision.approved", "verification.published"]);
  assert.ok(audits.every((a) => a.actorId === ADMIN.id));
  await assert.rejects(publishCorrection(store, ADMIN, EXEMPTION, PUBLISH_CONFIRMATION), /Only approved content/, "cannot publish twice");
});

test("published correction: new checklists use it, applicability logic is unchanged, and eligibility stays unresolved", async () => {
  const { store } = createMemoryVerificationStore();
  await saveProposedCorrection(store, ADMIN, EXEMPTION, DRAFT);
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  await recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "SIM: read every cited section in full.", confirmation: APPROVE_CONFIRMATION });
  await publishCorrection(store, ADMIN, EXEMPTION, PUBLISH_CONFIRMATION);
  const overrides = publishedOverrides(ALL_RULES, await store.listCorrectionVersions(), await store.listStates());

  const answers: Answers = {
    companyState: "TX", licenseState: "OK", operatingState: "TX", operationType: "INTERSTATE", cdlVehicle: true, cdlClass: "A", hazmat: false, passengers: false, tankOrDoublesAssignment: "NO",
    dotTesting: "YES", experience: "EXPERIENCED", priorDotEmployment: "YES", nonFmcsaDotEmployer: "NO", priorViolation: "NO", preEmploymentTestException: "NO", exemption: "CLAIMED", employmentStartDate: "2026-11-02",
  };
  const org = { baseState: "TX", preEmploymentAlcoholTesting: false };
  const before = generateChecklist(WORKFLOWS.HIRE_CDL_DRIVER, answers, org);
  const after = generateChecklist(WORKFLOWS.HIRE_CDL_DRIVER, answers, org, {}, overrides);
  assert.deepEqual(after.items.map((i) => [i.ruleId, i.classification, i.blocksSafetySensitive]), before.items.map((i) => [i.ruleId, i.classification, i.blocksSafetySensitive]), "same steps, same applicability, same restrictions");
  const step = after.items.find((i) => i.ruleId === EXEMPTION)!;
  assert.equal(step.title, DRAFT.title);
  assert.equal(step.ruleVersion, exemptionRule.version + 1);
  assert.equal(step.blocksSafetySensitive, true, "the operational restriction is preserved");
  assert.equal(contentReview(step.ruleSnapshot).state, "REVIEWED");

  // Reviewed content ≠ the customer qualifies.
  const eligibility = applicabilityStatus(step.ruleSnapshot, step.classification);
  assert.equal(eligibility.resolved, false);
  assert.match(eligibility.label, /Eligibility: not established/);
  assert.match(eligibility.detail, /does not establish that you qualify/);

  // The same user with no exemption claimed never sees the step; an old saved snapshot stays pending.
  assert.equal(generateChecklist(WORKFLOWS.HIRE_CDL_DRIVER, { ...answers, exemption: "NONE" }, org, {}, overrides).items.find((i) => i.ruleId === EXEMPTION)!.classification, "NOT_APPLICABLE");
  const saved = before.items.find((i) => i.ruleId === EXEMPTION)!.ruleSnapshot;
  assert.equal(contentReview(saved).state, "PENDING");
  assert.equal(contentReview(saved).label, "Regulatory guidance pending review");
  assert.equal(contentReview(saved).detail, exemptionRule.verificationNote, "what is uncertain is explained");
});

// ───────────────────────── Citation cases ─────────────────────────

test("case 1 — a valid, current citation is retrieved with link, text, dates and existence; still not an approval", async () => {
  const rule = stepWith("SIM-VALID", [ecfr("391.23", "49 CFR 391.23(a)")]);
  const { store, reviews } = createMemoryVerificationStore();
  const check = await runSourceCheck(store, fakeEcfr({ issue: "2026-10-09" }), ADMIN, rule.id, { catalog: catalogWith(rule), now: new Date("2026-10-11T09:00:00Z") });
  assert.equal(check.outcome, "RETRIEVED");
  const s = check.sections[0];
  assert.deepEqual([s.section, s.exists, s.removed, s.reserved, s.issueDate, s.lastAmended, s.retrievedAt], ["391.23", true, false, false, "2026-10-09", "2020-01-01", "2026-10-11T09:00:00.000Z"]);
  assert.match(s.retrievedFrom!, /^https:\/\/www\.ecfr\.gov\/api\//);
  assert.ok(s.excerpt!.startsWith("SIM text of § 391.23"));
  assert.ok(!check.findings.some((f) => f.severity === "PROBLEM"));
  assert.equal((await store.getState(rule.id))!.status, "SOURCE_CHECKED");
  assert.equal(reviews.length, 0);
  assert.equal(contentReview(rule).state, "PENDING");
});

test("case 2 — invalid citations: missing, removed and reserved sections, wrong link, bad format; approval is blocked", async () => {
  const missing = stepWith("SIM-MISSING", [ecfr("391.999")]);
  const { store } = createMemoryVerificationStore();
  let check = await runSourceCheck(store, fakeEcfr(), ADMIN, missing.id, { catalog: catalogWith(missing) });
  assert.equal(check.findings.find((f) => f.code === "SECTION_MISSING")!.severity, "PROBLEM");
  assert.equal(check.sections[0].exists, false);
  await assert.rejects(recordDecision(store, ADMIN, missing.id, { decision: "APPROVE", note: "SIM approving anyway.", confirmation: APPROVE_CONFIRMATION }, { catalog: catalogWith(missing) }), VerificationError);
  assert.notEqual((await store.getState(missing.id))!.status, "APPROVED_AWAITING_PUBLICATION");

  const removed = stepWith("SIM-REMOVED", [ecfr("391.21")]);
  check = await runSourceCheck(store, fakeEcfr({ removed: ["391.21"] }), ADMIN, removed.id, { catalog: catalogWith(removed) });
  assert.ok(check.findings.some((f) => f.code === "SECTION_REMOVED" && f.severity === "PROBLEM"));

  const reserved = stepWith("SIM-RESERVED", [ecfr("391.64")]);
  check = await runSourceCheck(store, fakeEcfr(), ADMIN, reserved.id, { catalog: catalogWith(reserved) });
  assert.equal(check.findings.find((f) => f.code === "SECTION_RESERVED")!.severity, "PROBLEM", "citing a reserved section directly is an error");

  const wrongLink = stepWith("SIM-WRONGLINK", [{ citation: "49 CFR 391.23(a)", url: "https://www.ecfr.gov/current/title-49/section-391.25" }]);
  assert.ok(offlineFindings(wrongLink, catalogWith(wrongLink)).some((f) => f.code === "LINK_TEXT_MISMATCH" && f.severity === "PROBLEM"));
  const badFormat = stepWith("SIM-FORMAT", [{ citation: "CFR three ninety-one", url: "https://www.fmcsa.dot.gov/regulations" }]);
  assert.ok(offlineFindings(badFormat, catalogWith(badFormat)).some((f) => f.code === "CITATION_FORMAT"));
  const unofficial = stepWith("SIM-UNOFFICIAL", [{ citation: "A trucking blog", url: "https://example.com/post" }]);
  assert.ok(offlineFindings(unofficial, catalogWith(unofficial)).some((f) => f.code === "NOT_OFFICIAL_SOURCE"));
  assert.ok(validateCorrection({ ...wordingOf(unofficial) }).sources, "a third-party page cannot be saved as a citation");
});

test("case 3 — a citation to an unrelated regulatory topic is raised as possible, for a person to decide", () => {
  const rule = stepWith("SIM-TOPIC", [ecfr("395.3")], { recordCategory: "DRUG_ALCOHOL_PROGRAM", title: "Send the driver for a SIM test" });
  const f = offlineFindings(rule, catalogWith(rule)).find((x) => x.code === "UNRELATED_TOPIC")!;
  assert.equal(f.severity, "POSSIBLE");
  assert.match(f.message, /hours of service/);
  assert.ok(!offlineFindings(stepWith("SIM-OK", [ecfr("382.301")], { recordCategory: "DRUG_ALCOHOL_PROGRAM", title: "Send the driver for a SIM test" })).some((x) => x.code === "UNRELATED_TOPIC"));
});

test("case 4 — an outdated or changed regulation: amended after the catalog was written, and detected changes are linked", async () => {
  const rule = stepWith("SIM-AMENDED", [ecfr("391.23")]);
  const change: DetectedChange = { id: "chg_1", title: "SIM-2026-00001 Driver qualification amendments", sourceUrl: "https://www.federalregister.gov/d/SIM-2026-00001", detectedAt: new Date("2026-10-09"), status: "DETECTED", section: null, parts: ["391"], legalStatus: "EFFECTIVE", actionType: "FINAL_RULE", mentions: [] };
  const { store } = createMemoryVerificationStore([change]);
  const check = await runSourceCheck(store, fakeEcfr({ amended: { "391.23": "2026-10-07" } }), ADMIN, rule.id, { catalog: catalogWith(rule) });
  const amended = check.findings.find((f) => f.code === "AMENDED_SINCE_CHECKED")!;
  assert.equal(amended.severity, "POSSIBLE");
  assert.match(amended.message, /amended on 2026-10-07/);
  assert.ok(check.findings.some((f) => f.code === "CHANGE_DETECTED"));
  assert.equal(check.relatedChanges[0].sourceUrl, change.sourceUrl);
  assert.equal(check.sections[0].lastAmended, "2026-10-07");
});

test("a source that cannot be reached keeps the step pending and is never read as 'nothing wrong'", async () => {
  const { store, reviews } = createMemoryVerificationStore();
  let check = await runSourceCheck(store, fakeEcfr({ down: true }), ADMIN, EXEMPTION);
  assert.equal(check.outcome, "FAILED");
  assert.equal((await store.getState(EXEMPTION))!.status, "REVIEW_REQUIRED");
  check = await runSourceCheck(store, fakeEcfr({ failText: ["391.61"] }), ADMIN, EXEMPTION);
  assert.notEqual(check.outcome, "RETRIEVED");
  assert.ok(check.findings.some((f) => f.code === "RETRIEVAL_FAILED"));
  assert.equal((await store.getState(EXEMPTION))!.status, "REVIEW_REQUIRED");
  await assert.rejects(recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "SIM: approving without the source.", confirmation: APPROVE_CONFIRMATION }), VerificationError);
  assert.equal(reviews.length, 0);

  // A step with no retrievable CFR section stays pending too, and approval needs an official link the reviewer names.
  const stateRule = ALL_RULES.find((r) => r.id === "STATE-NEW-STATE-LICENSING-PROCEDURE")!;
  check = await runSourceCheck(store, fakeEcfr(), ADMIN, stateRule.id);
  assert.equal(check.outcome, "NOTHING_TO_RETRIEVE");
  assert.notEqual((await store.getState(stateRule.id))!.status, "SOURCE_CHECKED");
  await assert.rejects(recordDecision(store, ADMIN, stateRule.id, { decision: "APPROVE", note: "SIM: approving with no source named.", confirmation: APPROVE_CONFIRMATION }), /official source/);
  await assert.rejects(recordDecision(store, ADMIN, stateRule.id, { decision: "APPROVE", note: "SIM: relied on a summary site.", confirmation: APPROVE_CONFIRMATION, sources: ["https://example.com/summary"] }), /official \.gov/);
});

test("cases 5 and 6 — exemption eligibility and customer applicability stay unresolved whatever the content status", () => {
  // 5: pending content, exemption claimed.
  const pending = applicabilityStatus(exemptionRule, "CONDITIONALLY_REQUIRED");
  assert.equal(pending.resolved, false);
  assert.match(pending.detail, /each condition/);
  // 6: reviewed content, customer's answers do not establish applicability.
  const reviewed: RegulatoryRule = { ...ALL_RULES.find((r) => r.id === "FED-391.25-RECORDS-FROM-BOTH-STATES")!, humanReview: { reviewedAt: "2026-10-11T12:00:00.000Z", reviewId: "review_1" } };
  assert.equal(contentReview(reviewed).state, "REVIEWED");
  assert.match(contentReview(reviewed).detail, /not a finding that it applies to you/);
  const open = applicabilityStatus(reviewed, "UNABLE_TO_DETERMINE");
  assert.equal(open.resolved, false);
  assert.match(open.label, /not yet determined/);
  // And the reverse: resolving applicability says nothing about content review.
  assert.equal(applicabilityStatus(exemptionRule, "NOT_APPLICABLE").resolved, true);
  assert.equal(contentReview(exemptionRule).state, "PENDING");
  // A developer-checked step that no administrator reviewed claims no review.
  assert.equal(contentReview(ALL_RULES.find((r) => r.verificationStatus === "VERIFIED")!).state, "NONE");
});

test("case 7 — a previously approved item affected by a new regulatory change is flagged for renewed review; nothing is replaced", async () => {
  const changes: DetectedChange[] = [];
  const { store, reviews, versions } = createMemoryVerificationStore(changes);
  await saveProposedCorrection(store, ADMIN, EXEMPTION, DRAFT);
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  await recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "SIM: read every cited section in full.", confirmation: APPROVE_CONFIRMATION }, { now: new Date("2026-10-11T11:00:00Z") });
  await publishCorrection(store, ADMIN, EXEMPTION, PUBLISH_CONFIRMATION, { now: new Date("2026-10-11T12:00:00Z") });

  // Before the review, a proposal, and a change to another part: none trigger re-review.
  changes.push({ id: "old", title: "SIM earlier amendment", sourceUrl: "https://www.ecfr.gov/current/title-49/section-383.3", detectedAt: new Date("2026-10-10"), status: "DETECTED", section: "383.3", parts: ["383"], legalStatus: "EFFECTIVE", actionType: "TEXT_CHANGE", mentions: [] });
  changes.push({ id: "nprm", title: "SIM proposed rule", sourceUrl: "https://www.federalregister.gov/d/SIM-2", detectedAt: new Date("2026-10-20"), status: "DETECTED", section: null, parts: ["391"], legalStatus: "PROPOSED", actionType: "PROPOSED_RULE", mentions: [] });
  changes.push({ id: "other", title: "SIM hours rule", sourceUrl: "https://www.federalregister.gov/d/SIM-3", detectedAt: new Date("2026-10-20"), status: "DETECTED", section: "395.3", parts: ["395"], legalStatus: "EFFECTIVE", actionType: "TEXT_CHANGE", mentions: [] });
  assert.deepEqual(await flagReverification(store), []);
  assert.equal((await store.getState(EXEMPTION))!.status, "REVIEWED_PUBLISHED");

  changes.push({ id: "hit", title: "SIM § 383.3 text changed", sourceUrl: "https://www.ecfr.gov/current/title-49/section-383.3", detectedAt: new Date("2026-11-02"), status: "DETECTED", section: "383.3", parts: ["383"], legalStatus: "EFFECTIVE", actionType: "TEXT_CHANGE", mentions: [] });
  assert.deepEqual(await flagReverification(store), [{ ruleId: EXEMPTION, changeId: "hit" }]);
  const state = (await store.getState(EXEMPTION))!;
  assert.equal(state.status, "REVERIFICATION_REQUIRED");
  assert.equal(state.reverifyChangeId, "hit", "links to the detected change");
  assert.equal(state.publishedAt!.toISOString(), "2026-10-11T12:00:00.000Z", "the previous verification date is kept");
  assert.equal(versions.length, 1, "no new version was created automatically");
  assert.deepEqual(reviews.map((r) => r.outcome), ["APPROVED", "PUBLISHED"], "the earlier approval history is preserved");

  const live = publishedOverrides(ALL_RULES, await store.listCorrectionVersions(), await store.listStates())[EXEMPTION];
  assert.equal(live.title, DRAFT.title, "the approved content is still served");
  assert.equal(contentReview(live).state, "REVERIFY");
  assert.match(contentReview(live).detail, /Reviewed on 2026-10-11/);
  assert.equal(buildQueue(await store.listStates(), await store.listCorrectionVersions()).find((i) => i.rule.id === EXEMPTION)!.status, "REVERIFICATION_REQUIRED");
});

// ───────────────────────── Other decisions, authorization, safeguards ─────────────────────────

test("request correction, insufficient evidence and rejection are recorded; rejection warns customers; editing an approved draft withdraws the approval", async () => {
  const { store, reviews } = createMemoryVerificationStore();
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  let r = await recordDecision(store, ADMIN, EXEMPTION, { decision: "INSUFFICIENT_EVIDENCE", note: "SIM: FMCSA guidance not yet located." });
  assert.equal(r.state.status, "REVIEW_REQUIRED");
  r = await recordDecision(store, ADMIN, EXEMPTION, { decision: "REQUEST_CORRECTION", note: "SIM: citation too narrow; add 383.3." });
  assert.equal(r.state.status, "CORRECTION_REQUESTED");
  assert.equal(publishedOverrides(ALL_RULES, [], await store.listStates())[EXEMPTION], undefined, "a correction request alone changes nothing for customers");

  r = await recordDecision(store, ADMIN, EXEMPTION, { decision: "REJECT", note: "SIM: the wording lets a 391 exemption clear CDL items." });
  assert.equal(r.state.status, "CORRECTION_REQUESTED");
  const noticed = applyOverrides([exemptionRule], publishedOverrides(ALL_RULES, [], await store.listStates()))[0];
  assert.equal(contentReview(noticed).state, "REJECTED");
  assert.match(noticed.reviewNotice!, /Do not rely on this step/);
  assert.equal(noticed.blocksSafetySensitive, true, "the restriction stays in force");
  assert.deepEqual(reviews.map((x) => x.outcome), ["INSUFFICIENT_EVIDENCE", "CORRECTION_REQUESTED", "REJECTED"]);

  await saveProposedCorrection(store, ADMIN, EXEMPTION, DRAFT);
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  await recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "SIM: read every cited section in full.", confirmation: APPROVE_CONFIRMATION });
  const edited = await saveProposedCorrection(store, ADMIN, EXEMPTION, { ...DRAFT, title: "Edited after approval" });
  assert.notEqual(edited.status, "APPROVED_AWAITING_PUBLICATION");
  assert.equal(edited.approvedReviewId, null);
  await assert.rejects(publishCorrection(store, ADMIN, EXEMPTION, PUBLISH_CONFIRMATION), /Only approved content/);
  assert.equal(reviews.length, 4, "history is only ever added to");
});

test("every administrator action is refused for non-administrators and leaves no trace", async () => {
  const { store, states, reviews, versions, audits } = createMemoryVerificationStore();
  const disabled: Actor = { ...ADMIN, disabled: true };
  for (const who of [OWNER, disabled]) {
    await assert.rejects(runSourceCheck(store, fakeEcfr(), who, EXEMPTION), PlatformAdminRequiredError);
    await assert.rejects(saveProposedCorrection(store, who, EXEMPTION, DRAFT), PlatformAdminRequiredError);
    await assert.rejects(assignReviewer(store, who, EXEMPTION, "x"), PlatformAdminRequiredError);
    await assert.rejects(recordDecision(store, who, EXEMPTION, { decision: "REJECT", note: "SIM: not allowed to do this." }), PlatformAdminRequiredError);
    await assert.rejects(previewPublication(store, who, EXEMPTION), PlatformAdminRequiredError);
    await assert.rejects(publishCorrection(store, who, EXEMPTION, PUBLISH_CONFIRMATION), PlatformAdminRequiredError);
  }
  assert.deepEqual([states.size, reviews.length, versions.length, audits.length], [0, 0, 0, 0]);
  const assigned = await assignReviewer(store, ADMIN, EXEMPTION, "admin_2");
  assert.equal(assigned.assigneeId, "admin_2");
  assert.equal(assigned.status, "REVIEW_REQUIRED", "assigning a reviewer is not a review");
});

test("a correction can change wording and citations only, and a later catalog version takes over from an older correction", () => {
  assert.ok(validateCorrection({ ...DRAFT, requiredAction: [] }).requiredAction);
  assert.ok(validateCorrection({ ...DRAFT, sources: [{ citation: "49 CFR 391.2", url: "http://www.ecfr.gov/current/title-49/section-391.2" }] }).sources, "https only");
  assert.ok(validateCorrection({ ...DRAFT, sources: [{ citation: "49 CFR 391.2", url: "https://www.ecfr.gov/current/title-49/section-383.3" }] }).sources, "text and link must agree");
  const v2: RegulatoryRule = { ...exemptionRule, version: 2, title: "Correction v2", humanReview: { reviewedAt: "2026-10-11T12:00:00.000Z", reviewId: "r" } };
  const corrections = [{ ruleId: EXEMPTION, version: 2, snapshot: v2, publishedAt: new Date(), reviewId: "r", publishedById: "a" }];
  assert.equal(applyOverrides([exemptionRule], publishedOverrides(ALL_RULES, corrections, []))[0].title, "Correction v2");
  const catalogV3 = ALL_RULES.map((r) => (r.id === EXEMPTION ? { ...r, version: 3, title: "Catalog v3" } : r));
  assert.equal(publishedOverrides(catalogV3, corrections, [])[EXEMPTION], undefined);
});

test("existing behaviour is intact: with nothing published, checklists are exactly the catalog's", () => {
  const answers: Answers = { reviewType: "NEW_ENTRANT_AUDIT", issuer: "FMCSA", operationType: "INTERSTATE", reviewFormat: "REMOTE", carrierClass: "GENERAL", cdlDrivers: true };
  const org = { baseState: "TX", preEmploymentAlcoholTesting: false };
  const a = generateChecklist(WORKFLOWS.AUDIT_NOTICE, answers, org);
  const b = generateChecklist(WORKFLOWS.AUDIT_NOTICE, answers, org, {}, {});
  assert.deepEqual(b.items.map((i) => [i.ruleId, i.ruleVersion, i.title, i.classification]), a.items.map((i) => [i.ruleId, i.ruleVersion, i.title, i.classification]));
  assert.ok(ALL_RULES.every((r) => r.humanReview === undefined && r.reviewNotice === undefined), "the code catalog never claims a human review");
});

// ───────────────────────── Citation coverage, reserved sections, change relevance, finding handling ─────────────────────────

test("coverage: a range citation is broken into its individual sections with status and official link; reserved ones are set apart", async () => {
  const { store } = createMemoryVerificationStore();
  const check = await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  const g = check.coverage.find((x) => x.citation === exemptionRule.sources[0].citation)!;
  assert.deepEqual([g.kind, g.part, g.from, g.to, g.linkedSection, g.origin], ["RANGE", "391", "391.61", "391.69", "391.61", "CURRENT"]);
  assert.deepEqual(g.sections.map((s) => s.section), ["391.61", "391.62", "391.63", "391.64", "391.65", "391.67", "391.68", "391.69"]);
  for (const s of g.sections) assert.equal(s.officialUrl, `https://www.ecfr.gov/current/title-49/section-${s.section}`);
  const reserved = g.sections.find((s) => s.section === "391.64")!;
  assert.deepEqual([reserved.activity, reserved.suggested], ["RESERVED", false], "a reserved section is identified and never offered as a requirement to watch");
  assert.ok(g.sections.filter((s) => s.section !== "391.64").every((s) => s.activity === "ACTIVE" && s.suggested));
  const first = g.sections[0];
  assert.deepEqual([first.linkedNow, first.monitored], [true, true], "the one linked section is already monitored");
  assert.ok(g.sections.slice(1).every((s) => !s.linkedNow && !s.monitored), "the others were neither linked nor watched");

  const ev = check.sections.find((s) => s.section === "391.64")!;
  assert.deepEqual([ev.activity, ev.reserved, ev.direct, ev.textHash], ["RESERVED", true, false, null]);
  const note = check.findings.find((f) => f.code === "SECTION_RESERVED")!;
  assert.equal(note.severity, "INFO");
  assert.match(note.explanation, /states no requirement/);
  assert.ok(!check.sections.some((s) => s.section === "391.71"), "outside the cited range, so not assumed to be part of it");
});

test("coverage: active sections can be added to monitoring; reserved, removed and unlisted sections are refused; nothing customers see changes", async () => {
  const { store, watch, audits } = createMemoryVerificationStore();
  await assert.rejects(monitorCoverage(store, ADMIN, EXEMPTION, ["391.62"]), /Check Official Sources/);
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  await assert.rejects(monitorCoverage(store, ADMIN, EXEMPTION, ["391.62", "391.64"]), /391\.64/, "a reserved section cannot be monitored as a requirement");
  await assert.rejects(monitorCoverage(store, ADMIN, EXEMPTION, ["395.3"]), /not an active section found in this step's citations/, "a section the step does not cite is not assumed relevant");
  await assert.rejects(monitorCoverage(store, OWNER, EXEMPTION, ["391.62"]), PlatformAdminRequiredError);
  assert.equal(watch.size, 0);

  const added = await monitorCoverage(store, ADMIN, EXEMPTION, ["391.62", "391.63", "391.65", "391.67", "391.68", "391.69"]);
  assert.equal(added.length, 6);
  assert.deepEqual((await store.monitoredSections(EXEMPTION)).sort(), ["391.61", "391.62", "391.63", "391.65", "391.67", "391.68", "391.69"]);
  assert.match(watch.get(EXEMPTION)![0].citationText, /Coverage of “49 CFR Part 391 Subpart G/);
  assert.deepEqual(await monitorCoverage(store, ADMIN, EXEMPTION, ["391.62"]), [], "adding twice does nothing");
  assert.equal(audits.filter((a) => a.action === "verification.coverage_monitored").length, 2);
  const again = await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  assert.ok(again.coverage[0].sections.filter((s) => s.activity === "ACTIVE").every((s) => s.monitored));
  assert.deepEqual(publishedOverrides(ALL_RULES, await store.listCorrectionVersions(), await store.listStates()), {});

  // The dependency sync treats administrator-added coverage as intentional, not stale.
  const map = buildDependencyMap();
  const existing = {
    sourceKeys: ["ECFR", "FEDERAL_REGISTER", "FMCSA", "DOT"],
    provisions: [...map.provisions.map((p, i) => ({ id: `p${i}`, title: p.title, section: p.section })), { id: "px", title: 49, section: "391.62" }],
    refs: [...map.refs.map((r, i) => ({ id: `r${i}`, ruleId: r.ruleId, provisionKey: `${r.title}:${r.section}`, paragraphs: r.paragraphs, citationText: r.citationText, sourceUrl: r.sourceUrl, origin: "CATALOG" })),
      { id: "cov", ruleId: EXEMPTION, provisionKey: "49:391.62", paragraphs: [], citationText: "Coverage", sourceUrl: "https://www.ecfr.gov/current/title-49/section-391.62", origin: "COVERAGE" }],
    ruleVersions: ALL_RULES.map((r) => ({ ruleId: r.id, version: r.version })),
  };
  assert.deepEqual(planSync(existing, undefined, map).staleRefs, []);
});

test("coverage: a part-level citation is listed but nothing in it is retrieved, pre-selected or assumed to apply", async () => {
  const rule = stepWith("SIM-PART", [{ citation: "49 CFR Part 395", url: "https://www.ecfr.gov/current/title-49/part-395" }], { title: "Keep SIM hours records" });
  const { store } = createMemoryVerificationStore([], catalogWith(rule));
  assert.deepEqual([citationGroup(rule.sources[0])!.kind, citationGroup(rule.sources[0])!.part], ["PART", "395"]);
  assert.equal(citationGroup({ citation: "49 CFR 391.23(a)", url: "https://www.ecfr.gov/current/title-49/section-391.23" }), null, "an ordinary section citation is not a group");
  const flag = offlineFindings(rule, catalogWith(rule)).find((f) => f.code === "PART_LEVEL_CITATION")!;
  assert.equal(flag.severity, "POSSIBLE");
  assert.match(flag.explanation, /no section is assumed to apply/);
  const check = await runSourceCheck(store, fakeEcfr(), ADMIN, rule.id, { catalog: catalogWith(rule) });
  assert.deepEqual(check.coverage[0].sections.map((s) => [s.section, s.suggested]), [["395.1", false], ["395.3", false]]);
  assert.deepEqual(check.sections, [], "no section text is retrieved on the strength of a part number");
  assert.equal(check.outcome, "NOTHING_TO_RETRIEVE");
  assert.notEqual((await store.getState(rule.id))!.status, "SOURCE_CHECKED");
  // The administrator may still choose a specific section they have judged relevant.
  assert.deepEqual(await monitorCoverage(store, ADMIN, rule.id, ["395.3"], { catalog: catalogWith(rule) }), ["395.3"]);
});

test("citation repair is drafted, never published: ranges become individual active sections and a wrong link is corrected", async () => {
  const { store, reviews, versions } = createMemoryVerificationStore();
  const check = await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  const repair = proposeCitationRepair(wordingOf(exemptionRule), check)!;
  assert.deepEqual(repair.wording.sources.map((s) => s.citation), ["49 CFR 391.61", "49 CFR 391.62", "49 CFR 391.63", "49 CFR 391.65", "49 CFR 391.67", "49 CFR 391.68", "49 CFR 391.69"]);
  assert.match(repair.changes[0], /left out as inactive: § 391\.64 \(reserved\)/);
  assert.deepEqual({ ...repair.wording, sources: [] }, { ...wordingOf(exemptionRule), sources: [] }, "only citations change — the wording is untouched");
  assert.deepEqual(validateCorrection(repair.wording), {});

  const { state, changes } = await draftCitationRepair(store, ADMIN, EXEMPTION);
  assert.equal(state.proposedBy, "citation-repair");
  assert.equal(changes.length, 1);
  assert.notEqual(state.status, "APPROVED_AWAITING_PUBLICATION");
  assert.deepEqual([reviews.length, versions.length], [0, 0], "no approval and no publication");
  assert.deepEqual(publishedOverrides(ALL_RULES, await store.listCorrectionVersions(), await store.listStates()), {}, "customers still get the catalog step");
  await assert.rejects(draftCitationRepair(store, OWNER, EXEMPTION), PlatformAdminRequiredError);

  // A link that opens a different section from the one named.
  const wrong = stepWith("SIM-WRONGLINK-2", [{ citation: "49 CFR 391.23(a)", url: "https://www.ecfr.gov/current/title-49/section-391.21" }]);
  const s2 = createMemoryVerificationStore([], catalogWith(wrong));
  const c2 = await runSourceCheck(s2.store, fakeEcfr(), ADMIN, wrong.id, { catalog: catalogWith(wrong) });
  assert.equal(proposeCitationRepair(wordingOf(wrong), c2), null, "the named section was not retrieved, so no link is guessed");
  const withNamed = { ...c2, sections: [...c2.sections, { ...c2.sections[0], section: "391.23", activity: "ACTIVE" as const }] };
  const fixed = proposeCitationRepair(wordingOf(wrong), withNamed)!;
  assert.equal(fixed.wording.sources[0].url, "https://www.ecfr.gov/current/title-49/section-391.23");
  assert.equal(proposeCitationRepair(DRAFT, check), null, "nothing to repair when every citation is already an individual section");
});

test("change relevance: a shared part number is only ever 'possible'; section evidence is needed for more", () => {
  const cited = ["391.61", "391.63", "383.3"];
  const base = { id: "c", title: "SIM", sourceUrl: "https://www.federalregister.gov/d/SIM", detectedAt: new Date("2026-10-20"), status: "DETECTED", actionType: "FINAL_RULE" };
  const textChange = changeRelevance({ ...base, section: "391.63", parts: ["391"], legalStatus: "EFFECTIVE", mentions: [] }, cited);
  assert.deepEqual([textChange.level, textChange.sections], ["CONFIRMED", ["391.63"]]);
  const names = changeRelevance({ ...base, section: null, parts: ["383"], legalStatus: "PROPOSED", mentions: ["383.3", "383.5"] }, cited);
  assert.equal(names.level, "LIKELY");
  assert.match(names.why, /names § 383\.3, which this step cites.*a proposal/);
  const partOnly = changeRelevance({ ...base, section: null, parts: ["391"], legalStatus: "EFFECTIVE", mentions: [] }, cited);
  assert.equal(partOnly.level, "POSSIBLE");
  assert.match(partOnly.why, /Part-level match only.*may or may not touch § 391\.61, § 391\.63/);
  const elsewhere = changeRelevance({ ...base, section: null, parts: ["391"], legalStatus: "EFFECTIVE", mentions: ["391.41", "391.43"] }, cited);
  assert.equal(elsewhere.level, "UNLIKELY");
  assert.match(elsewhere.why, /names § 391\.41, § 391\.43; this step cites none of them/);
  const other = changeRelevance({ ...base, section: "395.3", parts: ["395"], legalStatus: "EFFECTIVE", mentions: [] }, cited);
  assert.notEqual(other.level, "CONFIRMED", "a text change to a section this step does not cite is not a confirmed hit");

  assert.deepEqual(sectionsMentioned("Qualification of Drivers; §§ 391.41 and 391.43; see also 383.71 and 49 CFR Parts 390 and 391; 12.5 percent", ["391"]), ["391.41", "391.43"]);
  assert.deepEqual(sectionsMentioned("English Language Proficiency; Out of Service Criteria", ["390", "391"]), []);
});

test("change relevance in a source check: each item says why it may matter, and a medical-qualification notice does not implicate the exemption step", async () => {
  const changes: DetectedChange[] = [
    { id: "elp", title: "SIM English Language Proficiency; Out of Service Criteria", sourceUrl: "https://www.federalregister.gov/d/SIM-ELP", detectedAt: new Date("2026-10-09"), status: "DETECTED", section: null, parts: ["390", "391"], legalStatus: "PROPOSED", actionType: "PROPOSED_RULE", mentions: [] },
    { id: "vision", title: "SIM Qualification of Drivers; Exemption Applications; Vision (§ 391.41)", sourceUrl: "https://www.federalregister.gov/d/SIM-VIS", detectedAt: new Date("2026-10-09"), status: "DETECTED", section: null, parts: ["391"], legalStatus: "UNKNOWN", actionType: "EXEMPTION", mentions: ["391.41"] },
    { id: "txt", title: "SIM § 391.63 text changed", sourceUrl: "https://www.ecfr.gov/current/title-49/section-391.63", detectedAt: new Date("2026-10-09"), status: "DETECTED", section: "391.63", parts: ["391"], legalStatus: "EFFECTIVE", actionType: "TEXT_CHANGE", mentions: [] },
  ];
  const { store } = createMemoryVerificationStore(changes);
  const check = await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  const by = (id: string) => check.findings.find((f) => f.changeId === id)!;
  assert.deepEqual([by("elp").severity, by("vision").severity, by("txt").severity], ["POSSIBLE", "INFO", "PROBLEM"]);
  assert.match(by("elp").message, /^Possibly relevant/);
  assert.match(by("elp").explanation, /Part-level match only/);
  assert.match(by("vision").message, /^Probably not relevant/);
  assert.match(by("vision").nextAction, /No action is expected/);
  assert.match(by("txt").message, /^Confirmed/);
  assert.equal(by("txt").sources[0].url, "https://www.ecfr.gov/current/title-49/section-391.63");
  assert.deepEqual(check.relatedChanges.map((c) => c.relevance.level).sort(), ["CONFIRMED", "POSSIBLE", "UNLIKELY"]);
  assert.ok(check.findings.every((f) => f.key && f.explanation && f.nextAction && Array.isArray(f.sources)), "every finding carries an explanation, sources and a next action");
});

test("re-review is triggered by section evidence, not by a rule that merely shares the part number", async () => {
  const changes: DetectedChange[] = [];
  const { store } = createMemoryVerificationStore(changes);
  await saveProposedCorrection(store, ADMIN, EXEMPTION, DRAFT);
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  await recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "SIM: read every cited section in full.", confirmation: APPROVE_CONFIRMATION }, { now: new Date("2026-10-11T11:00:00Z") });
  await publishCorrection(store, ADMIN, EXEMPTION, PUBLISH_CONFIRMATION, { now: new Date("2026-10-11T12:00:00Z") });
  const fr = { sourceUrl: "https://www.federalregister.gov/d/SIM", detectedAt: new Date("2026-11-01"), status: "DETECTED", section: null, legalStatus: "EFFECTIVE", actionType: "FINAL_RULE" };
  changes.push({ ...fr, id: "part-only", title: "SIM final rule, Part 391", parts: ["391"], mentions: [] });
  changes.push({ ...fr, id: "other-sections", title: "SIM final rule, medical", parts: ["391"], mentions: ["391.41"] });
  changes.push({ ...fr, id: "proposal", title: "SIM proposal naming 383.3", parts: ["383"], mentions: ["383.3"], legalStatus: "PROPOSED" });
  assert.deepEqual(await flagReverification(store), [], "none of these establishes that a cited section changed");
  assert.equal((await store.getState(EXEMPTION))!.status, "REVIEWED_PUBLISHED");
  changes.push({ ...fr, id: "names-cited", title: "SIM final rule amending § 382.103", parts: ["382"], mentions: ["382.103"] });
  assert.deepEqual(await flagReverification(store), [{ ruleId: EXEMPTION, changeId: "names-cited" }]);
});

test("findings can be marked resolved, not applicable (with a reason) or needing further review; the history is kept and approval waits for them", async () => {
  const { store, audits, reviews } = createMemoryVerificationStore();
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION); // no draft: the findings concern the content that would be approved
  const state0 = (await store.getState(EXEMPTION))!;
  const open0 = openFindings(currentFindings(exemptionRule, exemptionRule, state0), state0.findingReviews, "CURRENT").map((f) => f.key).sort();
  assert.deepEqual(open0, ["EXEMPTION_SCOPE|382", "EXEMPTION_SCOPE|383", `RANGE_COVERED_BY_ONE_LINK|${exemptionRule.sources[0].citation}`].sort());
  const approve = () => recordDecision(store, ADMIN, EXEMPTION, { decision: "APPROVE", note: "SIM: approving the current wording.", confirmation: APPROVE_CONFIRMATION });
  await assert.rejects(approve(), /3 findings on this content are still open/);

  await assert.rejects(reviewFinding(store, ADMIN, EXEMPTION, "EXEMPTION_SCOPE|383", "NOT_APPLICABLE", ""), /reason this finding does not apply/);
  await assert.rejects(reviewFinding(store, ADMIN, EXEMPTION, "EXEMPTION_SCOPE|383", "RESOLVED", "ok"), /how this finding was resolved/);
  await assert.rejects(reviewFinding(store, ADMIN, EXEMPTION, "NO_SUCH|finding", "RESOLVED", "SIM: nothing to see here."), /no longer exists/);
  await assert.rejects(reviewFinding(store, OWNER, EXEMPTION, "EXEMPTION_SCOPE|383", "RESOLVED", "SIM: customer owner tries."), PlatformAdminRequiredError);
  assert.equal((await store.getState(EXEMPTION))!.findingReviews, null);

  await reviewFinding(store, ADMIN, EXEMPTION, "EXEMPTION_SCOPE|383", "NEEDS_REVIEW", "SIM: need to read § 383.3 in full.", { now: new Date("2026-10-11T09:00:00Z") });
  await assert.rejects(approve(), /3 findings/, "‘requires further review’ keeps the finding open");
  await reviewFinding(store, ADMIN, EXEMPTION, "EXEMPTION_SCOPE|383", "NOT_APPLICABLE", "SIM: reviewer decided the step cannot reach CDL items.", { now: new Date("2026-10-11T10:00:00Z") });
  await reviewFinding(store, ADMIN, EXEMPTION, "EXEMPTION_SCOPE|382", "RESOLVED", "SIM: read § 382.103; testing unaffected.");
  await assert.rejects(approve(), /1 finding on this content is still open/);
  await reviewFinding(store, ADMIN, EXEMPTION, `RANGE_COVERED_BY_ONE_LINK|${exemptionRule.sources[0].citation}`, "RESOLVED", "SIM: every section in the range read individually.");

  const state = (await store.getState(EXEMPTION))!;
  const history = state.findingReviews!["EXEMPTION_SCOPE|383"];
  assert.deepEqual(history.map((h) => h.disposition), ["NEEDS_REVIEW", "NOT_APPLICABLE"], "earlier handling is kept, not overwritten");
  assert.deepEqual([history[0].by, history[0].at, history[1].note], [ADMIN.id, "2026-10-11T09:00:00.000Z", "SIM: reviewer decided the step cannot reach CDL items."]);
  assert.match(history[0].message, /§ 383\.3/, "the finding is recorded as it read at the time");
  const logged = audits.filter((a) => a.action === "verification.finding_reviewed");
  assert.equal(logged.length, 4);
  assert.deepEqual([logged[1].meta.previous, logged[1].meta.disposition], ["NEEDS_REVIEW", "NOT_APPLICABLE"]);
  assert.equal(reviews.length, 0, "handling a finding is not a regulatory decision");
  assert.equal(state.status, "SOURCE_CHECKED", "…and does not move the step forward");

  // With every finding dealt with, approval is possible again — still only by deliberate confirmation.
  assert.equal((await approve()).state.status, "APPROVED_AWAITING_PUBLICATION");
  // Handled findings no longer raise the step's queue priority reason.
  assert.ok(!buildQueue(await store.listStates(), []).find((i) => i.rule.id === EXEMPTION)!.priority.reasons.includes("Possible citation problem"));
});

test("a directly cited reserved or removed section can never be approved as a requirement, whatever the findings say", async () => {
  const rule = stepWith("SIM-RESERVED-2", [ecfr("391.64")]);
  const cat = catalogWith(rule);
  const { store } = createMemoryVerificationStore([], cat);
  const check = await runSourceCheck(store, fakeEcfr(), ADMIN, rule.id, { catalog: cat });
  const f = check.findings.find((x) => x.code === "SECTION_RESERVED")!;
  assert.equal(f.severity, "PROBLEM");
  assert.match(f.explanation, /must not be cited as one/);
  for (const x of openFindings(currentFindings(rule, rule, (await store.getState(rule.id))!, cat), null, "CURRENT")) await reviewFinding(store, ADMIN, rule.id, x.key, "RESOLVED", "SIM: marking it resolved anyway.", { catalog: cat });
  await assert.rejects(recordDecision(store, ADMIN, rule.id, { decision: "APPROVE", note: "SIM: approving a reserved citation.", confirmation: APPROVE_CONFIRMATION }, { catalog: cat }), /reserved, removed or missing section cannot be approved/);
});

test("none of this reaches customers: drafts, repairs, coverage, findings and source checks leave the served guidance exactly as it was", async () => {
  const answers: Answers = {
    companyState: "TX", licenseState: "OK", operatingState: "TX", operationType: "INTERSTATE", cdlVehicle: true, cdlClass: "A", hazmat: false, passengers: false, tankOrDoublesAssignment: "NO",
    dotTesting: "YES", experience: "EXPERIENCED", priorDotEmployment: "YES", nonFmcsaDotEmployer: "NO", priorViolation: "NO", preEmploymentTestException: "NO", exemption: "CLAIMED", employmentStartDate: "2026-11-02",
  };
  const org = { baseState: "TX", preEmploymentAlcoholTesting: false };
  const before = JSON.stringify(generateChecklist(WORKFLOWS.HIRE_CDL_DRIVER, answers, org).items);
  const { store } = createMemoryVerificationStore();
  await saveProposedCorrection(store, ADMIN, EXEMPTION, DRAFT, { proposedBy: "system-draft" });
  await runSourceCheck(store, fakeEcfr(), ADMIN, EXEMPTION);
  await monitorCoverage(store, ADMIN, EXEMPTION, ["391.62", "383.3", "382.103"]);
  await reviewFinding(store, ADMIN, EXEMPTION, "EXEMPTION_SCOPE|383", "RESOLVED", "SIM: addressed by the draft correction.");
  const overrides = publishedOverrides(ALL_RULES, await store.listCorrectionVersions(), await store.listStates());
  assert.deepEqual(overrides, {});
  const after = generateChecklist(WORKFLOWS.HIRE_CDL_DRIVER, answers, org, {}, overrides);
  assert.equal(JSON.stringify(after.items), before);
  const step = after.items.find((i) => i.ruleId === EXEMPTION)!;
  assert.equal(step.title, "Review the claimed regulatory exemption");
  assert.equal(contentReview(step.ruleSnapshot).label, "Regulatory guidance pending review");
});
