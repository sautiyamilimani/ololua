CREATE TABLE "customer_account_credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_meter_account_id" uuid NOT NULL,
	"entry_type" varchar(40) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_id" uuid,
	"transfer_id" uuid,
	"idempotency_key" varchar(100) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_credit_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "customer_account_credit_entries_type_check" CHECK ("customer_account_credit_entries"."entry_type" in ('PAYMENT_CREDIT','ALLOCATION','TRANSFER_IN','TRANSFER_OUT','REVERSAL')),
	CONSTRAINT "customer_account_credit_entries_amount_check" CHECK ("customer_account_credit_entries"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "customer_account_credit_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"token_hash" varchar(64),
	"recipient_email" varchar(254),
	"sender_approved_at" timestamp with time zone,
	"recipient_confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"reversal_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_credit_transfers_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "customer_account_credit_transfers_amount_check" CHECK ("customer_account_credit_transfers"."amount" > 0),
	CONSTRAINT "customer_account_credit_transfers_status_check" CHECK ("customer_account_credit_transfers"."status" in ('PENDING','CONFIRMED','REVOKED','EXPIRED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "payment_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"reversed_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"reversed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversals_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "payment_allocation_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reversal_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"billing_id" uuid NOT NULL,
	"customer_meter_account_id" uuid NOT NULL,
	"reversed_amount" numeric(12, 2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocation_reversals_amount_check" CHECK ("payment_allocation_reversals"."reversed_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_account_credit_entries" ADD CONSTRAINT "customer_account_credit_entries_customer_meter_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("customer_meter_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_credit_entries" ADD CONSTRAINT "customer_account_credit_entries_payment_id_customer_meter_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_meter_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_credit_entries" ADD CONSTRAINT "customer_account_credit_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_credit_transfers" ADD CONSTRAINT "customer_account_credit_transfers_from_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_credit_transfers" ADD CONSTRAINT "customer_account_credit_transfers_to_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_credit_transfers" ADD CONSTRAINT "customer_account_credit_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_payment_id_customer_meter_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."customer_meter_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_reversal_id_payment_reversals_id_fk" FOREIGN KEY ("reversal_id") REFERENCES "public"."payment_reversals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_payment_id_customer_meter_account_id_customer_meter_payments_id_customer_meter_account_id_fk" FOREIGN KEY ("payment_id","customer_meter_account_id") REFERENCES "public"."customer_meter_payments"("id","customer_meter_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_billing_id_customer_meter_account_id_customer_meter_billings_id_customer_meter_account_id_fk" FOREIGN KEY ("billing_id","customer_meter_account_id") REFERENCES "public"."customer_meter_billings"("id","customer_meter_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_customer_meter_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("customer_meter_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_reversals" ADD CONSTRAINT "payment_allocation_reversals_payment_id_billing_id_customer_meter_payment_allocations_payment_id_billing_id_fk" FOREIGN KEY ("payment_id","billing_id") REFERENCES "public"."customer_meter_payment_allocations"("payment_id","billing_id") ON DELETE restrict ON UPDATE no action;