-- Finding dispositions and coverage monitoring. Additive only: one defaulted column, one nullable column.
-- AlterTable
ALTER TABLE "RuleProvisionRef" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'CATALOG';

-- AlterTable
ALTER TABLE "RuleVerification" ADD COLUMN     "findingReviews" JSONB;
