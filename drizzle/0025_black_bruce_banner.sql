ALTER TABLE "customers" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "trashed_by" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_trashed_by_users_id_fk" FOREIGN KEY ("trashed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;