-- Older review upload actions stored a customer ID in the uploader column.
UPDATE "MediaAsset" AS media
SET "uploadedByCustomerId" = customer.id, "uploadedByUserId" = NULL
FROM "Customer" AS customer
WHERE media."uploadedByUserId" = customer.id AND media."businessId" = customer."businessId"
  AND NOT EXISTS (SELECT 1 FROM "User" AS staff WHERE staff.id = media."uploadedByUserId");
CREATE INDEX "MediaAsset_businessId_uploadStatus_createdAt_idx" ON "MediaAsset"("businessId", "uploadStatus", "createdAt");
CREATE INDEX "MediaAsset_businessId_uploadedByCustomerId_uploadStatus_idx" ON "MediaAsset"("businessId", "uploadedByCustomerId", "uploadStatus");
CREATE INDEX "MediaAsset_businessId_checksum_idx" ON "MediaAsset"("businessId", "checksum");
