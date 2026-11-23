CREATE SEQUENCE "public"."customer_meter_billings_invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
SELECT setval(
  'public.customer_meter_billings_invoice_number_seq',
  COALESCE(
    MAX(substring("invoice_number" FROM 9)::bigint),
    0
  ) + 1,
  false
)
FROM "customer_meter_billings"
WHERE "invoice_number" ~ '^OLO-INV-[0-9]{6,}$';