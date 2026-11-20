-- Align pending invitation and customer access uniqueness with account rules.
DROP INDEX "invitations_pending_user_unique";--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email_unique" ON "invitations" USING btree (lower("invited_email")) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_customer_unique" ON "invitations" USING btree ("customer_id") WHERE "invitations"."status" = 'pending' and "invitations"."customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_user_access_active_customer_unique" ON "customer_user_access" USING btree ("customer_id") WHERE "customer_user_access"."revoked_at" is null;