import type { PrismaClient } from "@prisma/client";
import { ALL_RULES, CATALOG_VERSION } from "../rules/catalog";
import type { RegulatoryRule } from "../rules/types";
import { buildDependencyMap, type DependencyMap, type ProvisionDependency, type RuleDependency } from "./dependencies";

/**
 * Sync the regulatory dependency tables from the rule catalog.
 *
 * planSync() is pure: given the catalog-derived map and what the database already
 * holds, it lists what to create and update. Running it again after applying yields
 * an empty plan (idempotent). applySync() performs the plan.
 *
 * The sync only inserts and refreshes dependency rows. It never deletes, never touches
 * compliance content, and never marks anything as reviewed. References that are no
 * longer in the catalog are reported as stale, not removed.
 */

export const REGULATORY_SOURCES = [
  { key: "ECFR", name: "Electronic Code of Federal Regulations", kind: "API", baseUrl: "https://www.ecfr.gov/api/versioner/v1", enabled: true },
  { key: "FEDERAL_REGISTER", name: "Federal Register", kind: "API", baseUrl: "https://www.federalregister.gov/api/v1", enabled: true },
  // Website sources stay disabled until a supported, structured feed is chosen for them (Stage 2).
  { key: "FMCSA", name: "Federal Motor Carrier Safety Administration", kind: "WEBSITE", baseUrl: "https://www.fmcsa.dot.gov", enabled: false },
  { key: "DOT", name: "U.S. Department of Transportation", kind: "WEBSITE", baseUrl: "https://www.transportation.gov", enabled: false },
] as const;

export interface ExistingState {
  sourceKeys: string[];
  provisions: Array<{ id: string; title: number; section: string }>;
  refs: Array<{ id: string; ruleId: string; provisionKey: string; paragraphs: string[]; citationText: string; sourceUrl: string; origin?: string }>;
  ruleVersions: Array<{ ruleId: string; version: number }>;
}

export interface SyncPlan {
  createSources: Array<(typeof REGULATORY_SOURCES)[number]>;
  createProvisions: ProvisionDependency[];
  createRefs: RuleDependency[];
  updateRefs: Array<{ id: string; ref: RuleDependency }>;
  /** In the database but no longer in the catalog. Reported, never deleted. */
  staleRefs: Array<{ id: string; ruleId: string; provisionKey: string }>;
  createRuleVersions: RegulatoryRule[];
}

const pKey = (p: { title: number; section: string }) => `${p.title}:${p.section}`;
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export function planSync(existing: ExistingState, rules: RegulatoryRule[] = ALL_RULES, map: DependencyMap = buildDependencyMap(rules)): SyncPlan {
  const haveProvision = new Set(existing.provisions.map(pKey));
  const haveRef = new Map(existing.refs.map((r) => [`${r.ruleId}|${r.provisionKey}`, r]));
  const haveVersion = new Set(existing.ruleVersions.map((v) => `${v.ruleId}@${v.version}`));
  const wanted = new Set(map.refs.map((r) => `${r.ruleId}|${pKey(r)}`));

  const createRefs: RuleDependency[] = [];
  const updateRefs: SyncPlan["updateRefs"] = [];
  for (const ref of map.refs) {
    const current = haveRef.get(`${ref.ruleId}|${pKey(ref)}`);
    if (!current) createRefs.push(ref);
    else if (current.origin === "COVERAGE" || !sameSet(current.paragraphs, ref.paragraphs) || current.citationText !== ref.citationText || current.sourceUrl !== ref.sourceUrl) updateRefs.push({ id: current.id, ref });
  }

  return {
    createSources: REGULATORY_SOURCES.filter((s) => !existing.sourceKeys.includes(s.key)),
    createProvisions: map.provisions.filter((p) => !haveProvision.has(pKey(p))),
    createRefs,
    updateRefs,
    // Sections an administrator added to monitoring for range / subpart coverage are not in the catalog by design; they are not stale.
    staleRefs: existing.refs.filter((r) => r.origin !== "COVERAGE" && !wanted.has(`${r.ruleId}|${r.provisionKey}`)).map((r) => ({ id: r.id, ruleId: r.ruleId, provisionKey: r.provisionKey })),
    createRuleVersions: rules.filter((r) => !haveVersion.has(`${r.id}@${r.version}`)),
  };
}

export function isEmptyPlan(plan: SyncPlan): boolean {
  return !plan.createSources.length && !plan.createProvisions.length && !plan.createRefs.length && !plan.updateRefs.length && !plan.createRuleVersions.length;
}

export async function readExistingState(prisma: PrismaClient): Promise<ExistingState> {
  const [sources, provisions, refs, ruleVersions] = await Promise.all([
    prisma.regulatorySource.findMany({ select: { key: true } }),
    prisma.regulatoryProvision.findMany({ select: { id: true, title: true, section: true } }),
    prisma.ruleProvisionRef.findMany({ select: { id: true, ruleId: true, paragraphs: true, citationText: true, sourceUrl: true, origin: true, provision: { select: { title: true, section: true } } } }),
    prisma.ruleVersion.findMany({ select: { ruleId: true, version: true } }),
  ]);
  return {
    sourceKeys: sources.map((s) => s.key),
    provisions,
    refs: refs.map((r) => ({ id: r.id, ruleId: r.ruleId, provisionKey: pKey(r.provision), paragraphs: r.paragraphs, citationText: r.citationText, sourceUrl: r.sourceUrl, origin: r.origin })),
    ruleVersions,
  };
}

export interface SyncResult {
  sourcesCreated: number;
  provisionsCreated: number;
  refsCreated: number;
  refsUpdated: number;
  staleRefs: number;
  ruleVersionsCreated: number;
}

/** Apply a plan in one transaction. Inserts and refreshes only — no deletes. */
export async function applySync(prisma: PrismaClient, plan: SyncPlan): Promise<SyncResult> {
  await prisma.$transaction(async (tx) => {
    for (const s of plan.createSources) await tx.regulatorySource.create({ data: { key: s.key, name: s.name, kind: s.kind, baseUrl: s.baseUrl, enabled: s.enabled } });
    for (const p of plan.createProvisions) await tx.regulatoryProvision.create({ data: { title: p.title, part: p.part, section: p.section, sourceUrl: p.sourceUrl } });

    const provisions = await tx.regulatoryProvision.findMany({ select: { id: true, title: true, section: true } });
    const idOf = new Map(provisions.map((p) => [pKey(p), p.id]));
    for (const r of plan.createRefs)
      await tx.ruleProvisionRef.create({ data: { ruleId: r.ruleId, provisionId: idOf.get(pKey(r))!, paragraphs: r.paragraphs, citationText: r.citationText, sourceUrl: r.sourceUrl } });
    for (const { id, ref } of plan.updateRefs) await tx.ruleProvisionRef.update({ where: { id }, data: { paragraphs: ref.paragraphs, citationText: ref.citationText, sourceUrl: ref.sourceUrl, origin: "CATALOG" } });

    // Published rule versions are immutable: only versions that are missing are inserted.
    for (const r of plan.createRuleVersions)
      await tx.ruleVersion.create({ data: { ruleId: r.id, version: r.version, snapshot: r as unknown as object, verificationStatus: r.verificationStatus, lastVerified: r.lastVerified, catalogVersion: CATALOG_VERSION } });
  }, { timeout: 60_000 });

  return {
    sourcesCreated: plan.createSources.length,
    provisionsCreated: plan.createProvisions.length,
    refsCreated: plan.createRefs.length,
    refsUpdated: plan.updateRefs.length,
    staleRefs: plan.staleRefs.length,
    ruleVersionsCreated: plan.createRuleVersions.length,
  };
}
