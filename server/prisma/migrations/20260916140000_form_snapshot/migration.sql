-- AlterTable
ALTER TABLE "intake_submissions" ADD COLUMN     "schema_snapshot" JSONB;

-- AlterTable
ALTER TABLE "form_fields" ADD COLUMN     "deleted_at" TIMESTAMP(3);


-- Preserve the best available legacy definition BEFORE administrators can edit it.
-- This cannot recreate labels/fields already hard-deleted before this migration.
UPDATE intake_submissions AS s
SET schema_snapshot = COALESCE((
  SELECT jsonb_agg(x.definition ORDER BY x.form_order, x.page, x.sort, x.id)
  FROM (
    SELECT DISTINCT ON (f.key)
      CASE WHEN f.form_id = s.form_id THEN 0 ELSE array_position(s.extra_form_ids, f.form_id) END AS form_order,
      f.page, f.sort, f.id,
      jsonb_build_object('key', f.key, 'label', f.label, 'type', f.type,
        'options', f.options, 'page', f.page, 'roles', f.roles, 'docCategory', f.doc_category) AS definition
    FROM form_fields f
    WHERE NOT f.builtin AND (f.form_id = s.form_id OR f.form_id = ANY(s.extra_form_ids))
    ORDER BY f.key, CASE WHEN f.form_id = s.form_id THEN 0 ELSE array_position(s.extra_form_ids, f.form_id) END,
      f.page, f.sort, f.id
  ) x
), '[]'::jsonb)
WHERE s.schema_snapshot IS NULL AND s.status <> 'pending_fill'
  AND (s.form_id IS NOT NULL OR cardinality(s.extra_form_ids) > 0);
