CREATE SEQUENCE "public"."customer_meter_accounts_account_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
SELECT setval(
  'public.customer_meter_accounts_account_number_seq',
  COALESCE(
    MAX(substring("account_number" FROM 5)::bigint),
    0
  ) + 1,
  false
)
FROM "customer_meter_accounts"
WHERE "account_number" ~ '^OLO-[0-9]{6,}$';