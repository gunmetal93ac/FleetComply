-- Regulatory verification workflow. Additive only: new nullable columns, one defaulted column, one new table.
-- AlterTable
ALTER TABLE "RuleReview" ADD COLUMN     "claim" JSONB,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "previousWording" JSONB,
ADD COLUMN     "regulatoryVersion" TEXT,
ADD COLUMN     "updatedWording" JSONB;

-- AlterTable
ALTER TABLE "RuleVersion" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'CATALOG',
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "reviewId" TEXT;

-- CreateTable
CREATE TABLE "RuleVerification" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
    "assigneeId" TEXT,
    "lastSourceCheckAt" TIMESTAMP(3),
    "sourceCheck" JSONB,
    "proposedCorrection" JSONB,
    "proposedBy" TEXT,
    "proposedAt" TIMESTAMP(3),
    "approvedReviewId" TEXT,
    "publishedVersion" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "reverifyChangeId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuleVerification_ruleId_key" ON "RuleVerification"("ruleId");

-- CreateIndex
CREATE INDEX "RuleVerification_status_idx" ON "RuleVerification"("status");
