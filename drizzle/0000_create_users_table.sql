CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone_number" varchar(20),
	"password_hash" text,
	"account_type" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_type_check" CHECK ("users"."account_type" in ('staff', 'customer')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('invited', 'active', 'suspended', 'disabled')),
	CONSTRAINT "users_failed_login_count_check" CHECK ("users"."failed_login_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_number_unique" ON "users" USING btree ("phone_number");