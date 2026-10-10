-- Regulatory Intelligence, Stage 2 (monitoring).
-- Additive only: three new nullable/defaulted columns. No data is dropped or rewritten.
-- AlterTable
ALTER TABLE "RegulatoryChange" ADD COLUMN     "cfrParts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "details" JSONB;

-- AlterTable
ALTER TABLE "RegulatorySource" ADD COLUMN     "lockedUntil" TIMESTAMP(3);

