ALTER TABLE "MediaAsset" ADD COLUMN "uploadedByCustomerId" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "uploadStatus" TEXT NOT NULL DEFAULT 'READY';
UPDATE "MediaAsset" SET "uploadStatus" = 'PENDING' WHERE metadata->>'pendingUpload' = 'true';
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadStatus_check" CHECK ("uploadStatus" IN ('PENDING', 'READY', 'REJECTED'));
