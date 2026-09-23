-- Historical Prisma-generated migration (typo in the folder name is kept so
-- existing local folders checksum-match after pull). It dropped
-- Product_unitLabelId_fkey even when that constraint had never been created
-- (the column is added in 20260923090000). Use IF EXISTS so a fresh reset
-- does not abort with SQLSTATE 42704.
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_unitLabelId_fkey";
