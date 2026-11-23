CREATE SEQUENCE "public"."customers_customer_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
SELECT setval(
  'public.customers_customer_number_seq',
  COALESCE(
    MAX(substring("customer_number" FROM 5)::bigint),
    0
  ) + 1,
  false
)
FROM "customers"
WHERE "customer_number" ~ '^OLO-[0-9]{6,}$';