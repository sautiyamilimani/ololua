CREATE TABLE "staff_customer_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "staff_customer_access" ADD CONSTRAINT "staff_customer_access_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_access" ADD CONSTRAINT "staff_customer_access_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_access" ADD CONSTRAINT "staff_customer_access_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_access" ADD CONSTRAINT "staff_customer_access_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_customer_access_active_staff_unique" ON "staff_customer_access" USING btree ("staff_user_id") WHERE "staff_customer_access"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_customer_access_active_customer_unique" ON "staff_customer_access" USING btree ("customer_id") WHERE "staff_customer_access"."revoked_at" is null;