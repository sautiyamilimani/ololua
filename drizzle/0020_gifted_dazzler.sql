CREATE SEQUENCE "public"."customer_meter_payments_receipt_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
SELECT setval(
  'public.customer_meter_payments_receipt_number_seq',
  COALESCE(
    MAX(substring("receipt_number" FROM 10)::bigint),
    0
  ) + 1,
  false
)
FROM "customer_meter_payments"
WHERE "receipt_number" ~ '^OLO-RCP-[0-9]{6,}$';
--> statement-breakpoint--> statement-breakpoint
ALTER TABLE "customer_account_credit_entries" ADD CONSTRAINT "customer_account_credit_entries_transfer_id_customer_account_credit_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."customer_account_credit_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_account_credit_transfers" ADD CONSTRAINT "customer_account_credit_transfers_accounts_check" CHECK ("customer_account_credit_transfers"."from_account_id" <> "customer_account_credit_transfers"."to_account_id");