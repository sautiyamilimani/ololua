ALTER TABLE "service_tariffs"
DROP CONSTRAINT IF EXISTS "service_tariffs_active_period_no_overlap";
--> statement-breakpoint
ALTER TABLE "service_tariffs" ALTER COLUMN "effective_from" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "service_tariffs" ALTER COLUMN "effective_to" SET DATA TYPE timestamp with time zone;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "service_tariffs"
ADD CONSTRAINT "service_tariffs_active_period_exclude"
EXCLUDE USING gist (
  "service_variant_id" WITH =,
  tstzrange(
    "effective_from",
    COALESCE("effective_to", 'infinity'::timestamp with time zone),
    '[)'
  ) WITH &&
)
WHERE ("status" = 'ACTIVE');