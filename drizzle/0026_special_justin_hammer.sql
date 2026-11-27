CREATE TABLE "customer_email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "customer_email_verification_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "customer_email_verification_tokens_expiry_check" CHECK ("customer_email_verification_tokens"."expires_at" >= "customer_email_verification_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_email_verification_tokens" ADD CONSTRAINT "customer_email_verification_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_email_verification_tokens_active_customer_unique" ON "customer_email_verification_tokens" USING btree ("customer_id") WHERE "customer_email_verification_tokens"."invalidated_at" is null;