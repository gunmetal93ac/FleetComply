import type { Prisma, PrismaClient } from "@prisma/client";
import type { MonitorStore, NewChange, SourceKey, StoredProvision } from "./monitor";

/**
 * Database-backed storage for the regulatory monitor.
 *
 * It writes only to the Regulatory Intelligence tables (sources, provisions, text versions,
 * run log, detected changes). It has no method that touches rules, workflows, scenarios or
 * RuleVersion — the monitor cannot change compliance content.
 */
export function prismaMonitorStore(prisma: PrismaClient): MonitorStore {
  const sourceId = new Map<string, string>();
  async function idOf(key: SourceKey): Promise<string> {
    if (!sourceId.has(key)) {
      const s = await prisma.regulatorySource.findUnique({ where: { key }, select: { id: true } });
      if (!s) throw new Error(`Regulatory source ${key} is not set up — run "npm.cmd run reg:sync" first`);
      sourceId.set(key, s.id);
    }
    return sourceId.get(key)!;
  }

  return {
    async acquireLock(source, ttlMs) {
      const now = new Date();
      // Single atomic statement: only one caller can move lockedUntil forward from "free".
      const res = await prisma.regulatorySource.updateMany({
        where: { key: source, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        data: { lockedUntil: new Date(now.getTime() + ttlMs) },
      });
      return res.count === 1;
    },
    async releaseLock(source) {
      await prisma.regulatorySource.updateMany({ where: { key: source }, data: { lockedUntil: null } });
    },
    async startRun(source, trigger, triggeredById, attempt) {
      const run = await prisma.monitorRun.create({ data: { sourceId: await idOf(source), trigger, status: "RUNNING", attempt, triggeredById } });
      return run.id;
    },
    async finishRun(runId, r) {
      await prisma.monitorRun.update({
        where: { id: runId },
        data: { status: r.status, finishedAt: new Date(), provisionsChecked: r.provisionsChecked, changesDetected: r.changesDetected, error: r.error, details: r.details as Prisma.InputJsonValue },
      });
    },
    async markSource(source, ok, at) {
      await prisma.regulatorySource.update({ where: { key: source }, data: ok ? { lastSuccessAt: at } : { lastFailureAt: at } });
    },
    async listProvisions(): Promise<StoredProvision[]> {
      const rows = await prisma.regulatoryProvision.findMany({
        where: { monitored: true },
        select: { id: true, title: true, part: true, section: true, versions: { orderBy: { fetchedAt: "desc" }, take: 1, select: { id: true, versionRef: true, contentHash: true } } },
      });
      return rows.map((r) => ({ id: r.id, title: r.title, part: r.part, section: r.section, latest: r.versions[0] ?? null }));
    },
    async saveVersion(provisionId, v) {
      const existing = await prisma.provisionVersion.findUnique({ where: { provisionId_contentHash: { provisionId, contentHash: v.contentHash } }, select: { id: true } });
      if (existing) {
        // Same text under a newer amendment date: keep one row, move its reference and timestamp forward.
        await prisma.provisionVersion.update({ where: { id: existing.id }, data: { versionRef: v.versionRef, fetchedAt: new Date(), sourceUrl: v.sourceUrl } });
        return { id: existing.id, created: false };
      }
      const row = await prisma.provisionVersion.create({ data: { provisionId, versionRef: v.versionRef, contentHash: v.contentHash, text: v.text, sourceUrl: v.sourceUrl } });
      return { id: row.id, created: true };
    },
    async markChecked(provisionId, at, opts) {
      await prisma.regulatoryProvision.update({
        where: { id: provisionId },
        data: { lastCheckedAt: at, ...(opts.changed ? { lastChangedAt: at } : {}), ...(opts.heading ? { heading: opts.heading } : {}) },
      });
    },
    async addChange(c: NewChange) {
      const existing = await prisma.regulatoryChange.findUnique({ where: { source_externalId: { source: c.source, externalId: c.externalId } }, select: { id: true } });
      if (existing) return false;
      try {
        await prisma.regulatoryChange.create({
          data: {
            source: c.source,
            sourceId: await idOf(c.source),
            externalId: c.externalId,
            provisionId: c.provisionId ?? null,
            sourceUrl: c.sourceUrl,
            title: c.title,
            summary: c.summary,
            agency: c.agency,
            citation: c.citation,
            actionType: c.actionType,
            legalStatus: c.legalStatus,
            priority: c.priority,
            publicationDate: c.publicationDate,
            effectiveDate: c.effectiveDate,
            previousVersionId: c.previousVersionId ?? null,
            newVersionId: c.newVersionId ?? null,
            cfrParts: c.cfrParts,
            details: c.details as Prisma.InputJsonValue,
            status: "DETECTED",
            // Facts came straight from the official API in this run.
            sourceVerification: "SOURCE_CONFIRMED",
          },
        });
        return true;
      } catch (e) {
        // Unique (source, externalId): another run recorded it first.
        if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return false;
        throw e;
      }
    },
  };
}
