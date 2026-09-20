-- Media: a file name is unique inside its folder.
--
-- `/products/product.jpg` and `/brands/product.jpg` may both exist, two
-- `/products/product.jpg` may not. The service generates `product-1.jpg`,
-- `product-2.jpg`, … before inserting; these indexes are the authority that
-- makes two simultaneous uploads of the same name impossible (the loser's
-- insert is rejected and retried against the now-visible row).
--
-- Two partial indexes are needed because `folderId` is nullable and SQL
-- considers NULLs distinct: one for files inside a folder, one for the library
-- root. Both ignore soft-deleted rows so a deleted name can be reused.

-- 1. Repair existing duplicates so the indexes can be created. The oldest row
--    in each folder keeps its name; later rows get the same `-1`, `-2`, …
--    suffix the application generates, with the extension preserved. The loop
--    runs again when a generated name collided with a name that already
--    existed, so it terminates only once every folder is clash free.
DO $$
DECLARE
  repaired integer;
  guard integer := 0;
BEGIN
  LOOP
    WITH ranked AS (
      SELECT
        "id",
        "originalName",
        row_number() OVER (
          PARTITION BY "businessId", COALESCE("folderId", '00000000-0000-0000-0000-000000000000'), lower("originalName")
          ORDER BY "createdAt", "id"
        ) - 1 AS duplicate_index
      FROM "MediaAsset"
      WHERE "deletedAt" IS NULL
    )
    UPDATE "MediaAsset" AS target
    SET "originalName" =
      CASE
        WHEN strpos(reverse(ranked."originalName"), '.') IN (0, length(ranked."originalName"))
        THEN ranked."originalName" || '-' || ranked.duplicate_index
        ELSE
          left(ranked."originalName", length(ranked."originalName") - strpos(reverse(ranked."originalName"), '.'))
          || '-' || ranked.duplicate_index
          || right(ranked."originalName", strpos(reverse(ranked."originalName"), '.'))
      END
    FROM ranked
    WHERE target."id" = ranked."id" AND ranked.duplicate_index > 0;

    GET DIAGNOSTICS repaired = ROW_COUNT;
    EXIT WHEN repaired = 0;

    guard := guard + 1;
    IF guard > 50 THEN
      RAISE EXCEPTION 'Unable to make MediaAsset.originalName unique per folder after 50 passes';
    END IF;
  END LOOP;
END $$;

-- 2. Enforce it from here on.
CREATE UNIQUE INDEX "MediaAsset_folder_name_key"
  ON "MediaAsset"("businessId", "folderId", lower("originalName"))
  WHERE "deletedAt" IS NULL AND "folderId" IS NOT NULL;

CREATE UNIQUE INDEX "MediaAsset_root_name_key"
  ON "MediaAsset"("businessId", lower("originalName"))
  WHERE "deletedAt" IS NULL AND "folderId" IS NULL;
