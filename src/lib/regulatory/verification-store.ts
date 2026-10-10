import { Prisma, type PrismaClient } from "@prisma/client";
import { ALL_RULES } from "../rules/catalog";
import { CATALOG_VERSION } from "../rules/catalog/util";
import type { RegulatoryRule } from "../rules/types";
import { ecfrSectionUrl } from "./citations";
import { fetchSectionText, latestIssueDate, partStatus } from "./ecfr";
import { sectionsMentioned, type FindingReviews } from "./findings";
import { SourceHttpClient } from "./http";
import {
  publishedOverrides,
  type CorrectionVersion,
  type DetectedChange,
  type ReviewRecord,
  type SourceCheck,
  type SourceFetcher,
  type VerificationState,
  type VerificationStatus,
  type VerificationStore,
  type Wording,
} from "./verification";

/** PostgreSQL-backed store for the verification workflow. Inserts and updates only — nothing is deleted. */

type Tx = Pick<PrismaClient, "ruleVerification" | "ruleReview" | "ruleVersion" | "regulatoryChange" | "auditLog" | "regulatoryProvision" | "ruleProvisionRef">;

const toState = (r: any): VerificationState => ({
  ruleId: r.ruleId,
  status: r.status as VerificationStatus,
  assigneeId: r.assigneeId,
  lastSourceCheckAt: r.lastSourceCheckAt,
  sourceCheck: (r.sourceCheck ?? null) as SourceCheck | null,
  proposedCorrection: (r.proposedCorrection ?? null) as Wording | null,
  proposedBy: r.proposedBy,
  proposedAt: r.proposedAt,
  approvedReviewId: r.approvedReviewId,
  publishedVersion: r.publishedVersion,
  publishedAt: r.publishedAt,
  reverifyChangeId: r.reverifyChangeId,
  rejectedAt: r.rejectedAt,
  findingReviews: (r.findingReviews ?? null) as FindingReviews | null,
});

const toReview = (r: any): ReviewRecord => ({
  id: r.id,
  ruleId: r.ruleId,
  ruleVersion: r.ruleVersion,
  reviewerId: r.reviewerId,
  reviewedAt: r.reviewedAt,
  outcome: r.outcome,
  note: r.note,
  sources: Array.isArray(r.sources) ? (r.sources as string[]) : [],
  claim: (r.claim ?? null) as Wording | null,
  previousWording: (r.previousWording ?? null) as Wording | null,
  updatedWording: (r.updatedWording ?? null) as Wording | null,
  evidence: (r.evidence ?? null) as SourceCheck | null,
  regulatoryVersion: r.regulatoryVersion,
});

const json = (v: unknown) => (v === null || v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as object));

export function prismaVerificationStore(db: Tx): VerificationStore {
  return {
    async getState(ruleId) {
      const r = await db.ruleVerification.findUnique({ where: { ruleId } });
      return r ? toState(r) : null;
    },
    async listStates() {
      return (await db.ruleVerification.findMany()).map(toState);
    },
    async saveState(ruleId, patch) {
      const data: Record<string, unknown> = { ...patch };
      // Prisma needs an explicit database NULL to clear a JSON column.
      for (const k of ["sourceCheck", "proposedCorrection", "findingReviews"] as const) if (k in patch) data[k] = patch[k] === null ? Prisma.DbNull : json(patch[k]);
      const r = await db.ruleVerification.upsert({ where: { ruleId }, create: { ruleId, ...(data as object) }, update: data as object });
      return toState(r);
    },
    async addReview(r) {
      const row = await db.ruleReview.create({
        data: {
          ruleId: r.ruleId, ruleVersion: r.ruleVersion, reviewerId: r.reviewerId, reviewedAt: r.reviewedAt, outcome: r.outcome, note: r.note, sources: r.sources,
          claim: json(r.claim), previousWording: json(r.previousWording), updatedWording: json(r.updatedWording), evidence: json(r.evidence), regulatoryVersion: r.regulatoryVersion,
        },
      });
      return toReview(row);
    },
    async getReview(id) {
      const r = await db.ruleReview.findUnique({ where: { id } });
      return r ? toReview(r) : null;
    },
    async listReviews(ruleId) {
      return (await db.ruleReview.findMany({ where: { ruleId }, orderBy: { reviewedAt: "desc" } })).map(toReview);
    },
    async listCorrectionVersions(ruleId) {
      const rows = await db.ruleVersion.findMany({ where: { origin: "CORRECTION", ...(ruleId ? { ruleId } : {}) }, orderBy: { version: "asc" } });
      return rows.map((v): CorrectionVersion => ({ ruleId: v.ruleId, version: v.version, snapshot: v.snapshot as unknown as RegulatoryRule, publishedAt: v.publishedAt, reviewId: v.reviewId, publishedById: v.publishedById }));
    },
    async createCorrectionVersion(v) {
      // The unique (ruleId, version) key makes this fail rather than overwrite an existing version.
      await db.ruleVersion.create({
        data: {
          ruleId: v.ruleId, version: v.version, snapshot: json(v.snapshot)!, verificationStatus: v.snapshot.verificationStatus, lastVerified: v.snapshot.lastVerified,
          catalogVersion: CATALOG_VERSION, publishedAt: v.publishedAt, origin: "CORRECTION", reviewId: v.reviewId, publishedById: v.publishedById,
        },
      });
    },
    async changesFor(sections, parts) {
      const rows = await db.regulatoryChange.findMany({
        where: { OR: [{ provision: { section: { in: sections } } }, { provisionId: null, cfrParts: { hasSome: parts } }] },
        include: { provision: { select: { section: true } } },
        orderBy: { detectedAt: "desc" },
        take: 50,
      });
      // Section numbers are read only from the source's own descriptive fields (title, summary, citation line) — never inferred.
      return rows.map((c): DetectedChange => ({
        id: c.id, title: c.title ?? c.summary, sourceUrl: c.sourceUrl, detectedAt: c.detectedAt, status: c.status, section: c.provision?.section ?? null, parts: c.cfrParts,
        legalStatus: c.legalStatus, actionType: c.actionType, mentions: c.provision ? [] : sectionsMentioned([c.title, c.summary, c.citation].filter(Boolean).join(" "), c.cfrParts),
      }));
    },
    async monitoredSections(ruleId) {
      const refs = await db.ruleProvisionRef.findMany({ where: { ruleId }, select: { provision: { select: { section: true, monitored: true } } } });
      return refs.filter((r) => r.provision.monitored).map((r) => r.provision.section);
    },
    async addMonitoredSections(ruleId, items) {
      // Inserts only. An existing provision or reference is left exactly as it is.
      for (const item of items) {
        const part = item.section.split(".")[0];
        const provision = await db.regulatoryProvision.upsert({ where: { title_section: { title: 49, section: item.section } }, create: { title: 49, part, section: item.section, sourceUrl: ecfrSectionUrl(49, item.section) }, update: {} });
        await db.ruleProvisionRef.upsert({
          where: { ruleId_provisionId: { ruleId, provisionId: provision.id } },
          create: { ruleId, provisionId: provision.id, paragraphs: [], citationText: item.citationText, sourceUrl: ecfrSectionUrl(49, item.section), origin: "COVERAGE" },
          update: {},
        });
      }
    },
    async audit(actor, action, ruleId, meta) {
      await db.auditLog.create({ data: { orgId: actor.orgId, actorId: actor.id, action, entityType: "RegulatoryRule", entityId: ruleId, meta: json(meta) } });
    },
  };
}

/** Official eCFR access through the existing client: allow-listed hosts, one request at a time, timeouts and retries. */
export function ecfrFetcher(http: SourceHttpClient = new SourceHttpClient()): SourceFetcher {
  return {
    latestIssueDate: () => latestIssueDate(http),
    partStatus: (part) => partStatus(http, part),
    sectionText: (issue, section) => fetchSectionText(http, issue, section),
    requests: () => http.stats.requests,
  };
}

/**
 * What customers are served on top of the code catalog: published corrections and rejection
 * notices. Read-only. If the database cannot be reached the catalog is served as it is.
 */
export async function loadPublishedOverrides(db: Pick<PrismaClient, "ruleVerification" | "ruleVersion">, catalog: RegulatoryRule[] = ALL_RULES): Promise<Record<string, RegulatoryRule>> {
  try {
    const store = prismaVerificationStore(db as unknown as Tx);
    const [corrections, states] = await Promise.all([store.listCorrectionVersions(), store.listStates()]);
    if (!corrections.length && !states.some((s) => s.rejectedAt)) return {};
    return publishedOverrides(catalog, corrections, states);
  } catch (e) {
    console.error("Published corrections could not be loaded; serving the catalog.", e);
    return {};
  }
}
