import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, searchScenarios } from "../src/lib/search/scenario-search";
import { SCENARIOS } from "../src/lib/workflows/scenarios";
import { SCENARIO_KEYWORDS } from "../src/lib/search/keywords";

const top = (q: string) => searchScenarios(q)[0]?.scenario;
const topN = (q: string, n = 3) => searchScenarios(q).slice(0, n).map((r) => r.scenario);

test("hiring a CDL driver → live hiring workflow", () => {
  const s = top("I'm hiring a new CDL driver.");
  assert.equal(s?.workflow, "HIRE_CDL_DRIVER");
  assert.equal(s?.status, "LIVE");
});

test("accident → live accident workflow", () => {
  assert.equal(top("One of my drivers was involved in an accident.")?.workflow, "DOT_ACCIDENT_RESPONSE");
  assert.equal(top("we had a wreck on I-40")?.workflow, "DOT_ACCIDENT_RESPONSE");
  assert.equal(top("fatal crash")?.n, 31);
});

test("positive drug test and refusal → live violation workflow", () => {
  assert.equal(top("A driver tested positive on a DOT drug test.")?.n, 19);
  assert.equal(top("my driver popped on a drug test")?.n, 19);
  assert.equal(top("driver refused drug test")?.n, 20);
});

test("conversational descriptions map to the right (planned) scenario", () => {
  assert.equal(top("A driver's medical card expired.")?.n, 11);
  assert.equal(top("My truck failed a roadside inspection.")?.n, 28);
  assert.equal(top("I want to start operating trucks in another state.")?.n, 48);
  assert.equal(top("My driver received an out-of-service violation.")?.n, 27);
  assert.equal(top("My driver got pulled over and put out of service.")?.n, 27);
  assert.equal(top("eld stopped working")?.n, 42);
  assert.equal(top("starting a new trucking company")?.n, 47);
});

test("DQ file question surfaces the live hiring workflow among the top results", () => {
  const r = topN("What documents do I need for a driver qualification file?");
  assert.ok(r.some((s) => s.workflow === "HIRE_CDL_DRIVER" && s.status === "LIVE"));
});

test("typos and partial words still match", () => {
  assert.equal(top("acident")?.workflow, "DOT_ACCIDENT_RESPONSE");
  assert.ok([19, 20].includes(top("drug tset")?.n ?? 0));
  assert.equal(top("medcal card expird")?.n, 11);
  assert.ok(topN("clearinghouse").every((s) => SCENARIO_KEYWORDS[s.n]?.some((k) => k.includes("clearinghouse") || k === "_drugtest")));
});

test("unrelated or too-generic queries return nothing rather than a guess", () => {
  assert.deepEqual(searchScenarios("how do I bake bread"), []);
  assert.deepEqual(searchScenarios("driver"), []);
  assert.deepEqual(searchScenarios(""), []);
  assert.deepEqual(searchScenarios("   ?!  "), []);
});

test("results only ever reference existing catalog scenarios", () => {
  const ids = new Set(SCENARIOS.map((s) => s.n));
  for (const q of ["accident", "hire", "drug test", "brakes", "hours of service", "audit"])
    for (const r of searchScenarios(q)) assert.ok(ids.has(r.scenario.n));
});

test("every scenario has search keywords", () => {
  for (const s of SCENARIOS) assert.ok(SCENARIO_KEYWORDS[s.n]?.length, `scenario ${s.n} has no keywords`);
});

test("merged duplicates are never returned, but their wording still finds the scenario they merged into", () => {
  const merged = SCENARIOS.filter((s) => s.aliasOf !== undefined);
  assert.deepEqual(merged.map((s) => [s.n, s.aliasOf]), [[3, 1], [21, 26], [24, 7], [30, 26]]);
  for (const m of merged) {
    const target = SCENARIOS.find((s) => s.n === m.aliasOf)!;
    assert.equal(target.aliasOf, undefined, `scenario ${m.n} must point at a visible scenario`);
    assert.equal(target.workflow, m.workflow, `scenario ${m.n} and its target share a workflow`);
    assert.deepEqual(target.preset ?? {}, m.preset ?? {}, `scenario ${m.n} and its target pre-fill the same answers`);
  }
  for (const q of ["hire", "accident", "clearinghouse violation", "bridge", "driver with less than one year of experience", "is post-accident testing required"])
    for (const r of searchScenarios(q, 20)) assert.equal(r.scenario.aliasOf, undefined, `"${q}" returned merged scenario ${r.scenario.n}`);

  assert.equal(top("Hire a driver with less than one year of experience")?.n, 1);
  assert.equal(top("rookie driver straight out of school")?.n, 1);
  assert.equal(top("Driver has a prior Clearinghouse violation")?.n, 7);
  assert.equal(top("driver struck a bridge")?.n, 26);
  assert.equal(top("driver had an accident, is testing required?")?.n, 26);
});

test("analyze detects concepts and stems words", () => {
  const t = analyze("Pulled over and put out of service");
  assert.ok(t.includes("_oos") && t.includes("_roadside"));
  assert.ok(analyze("hiring").includes("hir") && analyze("hired").includes("hir"));
});
