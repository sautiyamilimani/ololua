CREATE TABLE "units_of_measure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_code" varchar(20) NOT NULL,
	"unit_name" varchar(50) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_of_measure_unit_code_unique" UNIQUE("unit_code"),
	CONSTRAINT "units_of_measure_unit_name_unique" UNIQUE("unit_name")
);
--> statement-breakpoint
CREATE TABLE "service_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_type_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"variant_code" varchar(40) NOT NULL,
	"variant_name" varchar(120) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_variants_variant_code_unique" UNIQUE("variant_code"),
	CONSTRAINT "service_variants_status_check" CHECK ("service_variants"."status" in ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "service_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_variant_id" uuid NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_tariffs_status_check" CHECK ("service_tariffs"."status" in ('DRAFT', 'ACTIVE', 'INACTIVE')),
	CONSTRAINT "service_tariffs_rate_check" CHECK ("service_tariffs"."rate" > 0),
	CONSTRAINT "service_tariffs_period_check" CHECK ("service_tariffs"."effective_to" is null or "service_tariffs"."effective_to" >= "service_tariffs"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial_number" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meters_serial_number_unique" UNIQUE("serial_number"),
	CONSTRAINT "meters_status_check" CHECK ("meters"."status" in ('ACTIVE', 'DEFECTIVE'))
);
--> statement-breakpoint
CREATE TABLE "customer_meter_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_number" varchar(30) NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_variant_id" uuid NOT NULL,
	"zone_id" uuid,
	"property_address" text NOT NULL,
	"location_description" text,
	"notes" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_meter_accounts_account_number_unique" UNIQUE("account_number"),
	CONSTRAINT "customer_meter_accounts_status_check" CHECK ("customer_meter_accounts"."status" in ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "meter_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meter_id" uuid NOT NULL,
	"customer_meter_account_id" uuid NOT NULL,
	"initial_reading" numeric(12, 3) NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"assigned_by" uuid,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meter_assignment_id" uuid NOT NULL,
	"reading_at" timestamp with time zone NOT NULL,
	"previous_reading" numeric(12, 3) NOT NULL,
	"current_reading" numeric(12, 3) NOT NULL,
	"consumption" numeric(12, 3) NOT NULL,
	"submitted_by" uuid,
	"idempotency_key" varchar(100) NOT NULL,
	"unusual_consumption_flag" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_readings_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "meter_readings_current_check" CHECK ("meter_readings"."current_reading" >= "meter_readings"."previous_reading"),
	CONSTRAINT "meter_readings_consumption_check" CHECK ("meter_readings"."consumption" = "meter_readings"."current_reading" - "meter_readings"."previous_reading")
);
--> statement-breakpoint
CREATE TABLE "customer_meter_billings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(40) NOT NULL,
	"customer_meter_account_id" uuid NOT NULL,
	"meter_reading_id" uuid NOT NULL,
	"service_tariff_id" uuid NOT NULL,
	"billing_period_start" date NOT NULL,
	"billing_period_end" date NOT NULL,
	"previous_reading" numeric(12, 3) NOT NULL,
	"current_reading" numeric(12, 3) NOT NULL,
	"consumption" numeric(12, 3) NOT NULL,
	"tariff_rate" numeric(12, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"due_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'UNPAID' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_meter_billings_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "customer_meter_billings_meter_reading_id_unique" UNIQUE("meter_reading_id"),
	CONSTRAINT "customer_meter_billings_id_account_unique" UNIQUE("id","customer_meter_account_id"),
	CONSTRAINT "customer_meter_billings_status_check" CHECK ("customer_meter_billings"."status" in ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED')),
	CONSTRAINT "customer_meter_billings_period_check" CHECK ("customer_meter_billings"."billing_period_end" >= "customer_meter_billings"."billing_period_start"),
	CONSTRAINT "customer_meter_billings_consumption_check" CHECK ("customer_meter_billings"."consumption" = "customer_meter_billings"."current_reading" - "customer_meter_billings"."previous_reading"),
	CONSTRAINT "customer_meter_billings_amount_check" CHECK ("customer_meter_billings"."total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_meter_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" varchar(40) NOT NULL,
	"external_reference" varchar(100),
	"customer_meter_account_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'COMPLETED' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"payer_phone" varchar(20),
	"checkout_request_id" varchar(100),
	"merchant_request_id" varchar(100),
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_meter_payments_receipt_number_unique" UNIQUE("receipt_number"),
	CONSTRAINT "customer_meter_payments_external_reference_unique" UNIQUE("external_reference"),
	CONSTRAINT "customer_meter_payments_checkout_request_id_unique" UNIQUE("checkout_request_id"),
	CONSTRAINT "customer_meter_payments_id_account_unique" UNIQUE("id","customer_meter_account_id"),
	CONSTRAINT "customer_meter_payments_amount_check" CHECK ("customer_meter_payments"."amount" > 0),
	CONSTRAINT "customer_meter_payments_method_check" CHECK ("customer_meter_payments"."payment_method" in ('cash', 'mpesa', 'bank', 'other')),
	CONSTRAINT "customer_meter_payments_status_check" CHECK ("customer_meter_payments"."status" in ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED'))
);
--> statement-breakpoint
CREATE TABLE "customer_meter_payment_allocations" (
	"payment_id" uuid NOT NULL,
	"billing_id" uuid NOT NULL,
	"customer_meter_account_id" uuid NOT NULL,
	"allocated_amount" numeric(12, 2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_meter_payment_allocations_payment_id_billing_id_pk" PRIMARY KEY("payment_id","billing_id"),
	CONSTRAINT "customer_meter_payment_allocations_amount_check" CHECK ("customer_meter_payment_allocations"."allocated_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_unit_id_units_of_measure_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_tariffs" ADD CONSTRAINT "service_tariffs_service_variant_id_service_variants_id_fk" FOREIGN KEY ("service_variant_id") REFERENCES "public"."service_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_tariffs" ADD CONSTRAINT "service_tariffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_accounts" ADD CONSTRAINT "customer_meter_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_accounts" ADD CONSTRAINT "customer_meter_accounts_service_variant_id_service_variants_id_fk" FOREIGN KEY ("service_variant_id") REFERENCES "public"."service_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_accounts" ADD CONSTRAINT "customer_meter_accounts_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_assignments" ADD CONSTRAINT "meter_assignments_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_assignments" ADD CONSTRAINT "meter_assignments_customer_meter_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("customer_meter_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_assignments" ADD CONSTRAINT "meter_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_assignments" ADD CONSTRAINT "meter_assignments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_assignment_id_meter_assignments_id_fk" FOREIGN KEY ("meter_assignment_id") REFERENCES "public"."meter_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_billings" ADD CONSTRAINT "customer_meter_billings_customer_meter_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("customer_meter_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_billings" ADD CONSTRAINT "customer_meter_billings_meter_reading_id_meter_readings_id_fk" FOREIGN KEY ("meter_reading_id") REFERENCES "public"."meter_readings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_billings" ADD CONSTRAINT "customer_meter_billings_service_tariff_id_service_tariffs_id_fk" FOREIGN KEY ("service_tariff_id") REFERENCES "public"."service_tariffs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_billings" ADD CONSTRAINT "customer_meter_billings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_payments" ADD CONSTRAINT "customer_meter_payments_customer_meter_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("customer_meter_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_payments" ADD CONSTRAINT "customer_meter_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_payments" ADD CONSTRAINT "customer_meter_payments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_payment_allocations" ADD CONSTRAINT "customer_meter_payment_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_payment_allocations" ADD CONSTRAINT "customer_meter_payment_allocations_payment_id_customer_meter_account_id_customer_meter_payments_id_customer_meter_account_id_fk" FOREIGN KEY ("payment_id","customer_meter_account_id") REFERENCES "public"."customer_meter_payments"("id","customer_meter_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_payment_allocations" ADD CONSTRAINT "customer_meter_payment_allocations_billing_id_customer_meter_account_id_customer_meter_billings_id_customer_meter_account_id_fk" FOREIGN KEY ("billing_id","customer_meter_account_id") REFERENCES "public"."customer_meter_billings"("id","customer_meter_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_meter_payment_allocations" ADD CONSTRAINT "customer_meter_payment_allocations_customer_meter_account_id_customer_meter_accounts_id_fk" FOREIGN KEY ("customer_meter_account_id") REFERENCES "public"."customer_meter_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meter_assignments_active_meter_unique" ON "meter_assignments" USING btree ("meter_id") WHERE "meter_assignments"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "meter_readings_assignment_time_unique" ON "meter_readings" USING btree ("meter_assignment_id","reading_at");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "service_tariffs"
ADD CONSTRAINT "service_tariffs_active_period_no_overlap"
EXCLUDE USING gist (
	"service_variant_id" WITH =,
	daterange("effective_from", "effective_to", '[)') WITH &&
)
WHERE ("status" = 'ACTIVE');