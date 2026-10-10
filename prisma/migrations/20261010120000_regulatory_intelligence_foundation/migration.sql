-- Regulatory Intelligence, Stage 1 (foundation).
-- Additive only: new tables, new nullable/defaulted columns, new indexes. No data is dropped or rewritten.
-- AlterTable
ALTER TABLE "RegulatoryChange" ADD COLUMN     "actionType" TEXT,
ADD COLUMN     "agency" TEXT,
ADD COLUMN     "citation" TEXT,
ADD COLUMN     "complianceDate" TIMESTAMP(3),
ADD COLUMN     "effectiveDate" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "legalStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "newVersionId" TEXT,
ADD COLUMN     "previousVersionId" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "provisionId" TEXT,
ADD COLUMN     "publicationDate" TIMESTAMP(3),
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceVerification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET DEFAULT 'DETECTED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RegulatorySource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatorySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryProvision" (
    "id" TEXT NOT NULL,
    "title" INTEGER NOT NULL,
    "part" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "heading" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryProvision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvisionVersion" (
    "id" TEXT NOT NULL,
    "provisionId" TEXT NOT NULL,
    "versionRef" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvisionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleProvisionRef" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "provisionId" TEXT NOT NULL,
    "paragraphs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "citationText" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleProvisionRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "provisionsChecked" INTEGER NOT NULL DEFAULT 0,
    "changesDetected" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB,
    "triggeredById" TEXT,

    CONSTRAINT "MonitorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleReview" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "sources" JSONB NOT NULL,

    CONSTRAINT "RuleReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySource_key_key" ON "RegulatorySource"("key");

-- CreateIndex
CREATE INDEX "RegulatoryProvision_part_idx" ON "RegulatoryProvision"("part");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryProvision_title_section_key" ON "RegulatoryProvision"("title", "section");

-- CreateIndex
CREATE INDEX "ProvisionVersion_provisionId_fetchedAt_idx" ON "ProvisionVersion"("provisionId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProvisionVersion_provisionId_contentHash_key" ON "ProvisionVersion"("provisionId", "contentHash");

-- CreateIndex
CREATE INDEX "RuleProvisionRef_provisionId_idx" ON "RuleProvisionRef"("provisionId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleProvisionRef_ruleId_provisionId_key" ON "RuleProvisionRef"("ruleId", "provisionId");

-- CreateIndex
CREATE INDEX "MonitorRun_startedAt_idx" ON "MonitorRun"("startedAt");

-- CreateIndex
CREATE INDEX "MonitorRun_status_startedAt_idx" ON "MonitorRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "RuleReview_ruleId_reviewedAt_idx" ON "RuleReview"("ruleId", "reviewedAt");

-- CreateIndex
CREATE INDEX "RegulatoryChange_status_detectedAt_idx" ON "RegulatoryChange"("status", "detectedAt");

-- CreateIndex
CREATE INDEX "RegulatoryChange_provisionId_idx" ON "RegulatoryChange"("provisionId");

-- CreateIndex
CREATE INDEX "RegulatoryChange_effectiveDate_idx" ON "RegulatoryChange"("effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryChange_source_externalId_key" ON "RegulatoryChange"("source", "externalId");

-- AddForeignKey
ALTER TABLE "ProvisionVersion" ADD CONSTRAINT "ProvisionVersion_provisionId_fkey" FOREIGN KEY ("provisionId") REFERENCES "RegulatoryProvision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleProvisionRef" ADD CONSTRAINT "RuleProvisionRef_provisionId_fkey" FOREIGN KEY ("provisionId") REFERENCES "RegulatoryProvision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorRun" ADD CONSTRAINT "MonitorRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryChange" ADD CONSTRAINT "RegulatoryChange_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RegulatorySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryChange" ADD CONSTRAINT "RegulatoryChange_provisionId_fkey" FOREIGN KEY ("provisionId") REFERENCES "RegulatoryProvision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

