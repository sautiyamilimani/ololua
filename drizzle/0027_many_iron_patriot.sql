-- Move customer-level legacy locations to accounts before removing the customer columns.
WITH ranked_customer_locations AS (
  SELECT
    account.id AS account_id,
    account.location_description AS existing_location_description,
    customer.location_description AS legacy_location_description,
    row_number() OVER (
      PARTITION BY customer.id
      ORDER BY account.created_at, account.account_number, account.id
    ) AS account_position
  FROM customers AS customer
  INNER JOIN customer_meter_accounts AS account
    ON account.customer_id = customer.id
  WHERE nullif(btrim(customer.location_description), '') IS NOT NULL
)
UPDATE customer_meter_accounts AS account
SET
  location_description = CASE
    WHEN ranked.account_position = 1 THEN ranked.legacy_location_description
    ELSE 'to be edited'
  END,
  updated_at = CURRENT_TIMESTAMP
FROM ranked_customer_locations AS ranked
WHERE account.id = ranked.account_id
  AND (
    ranked.account_position = 1
    OR nullif(btrim(ranked.existing_location_description), '') IS NULL
  );
--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "physical_address";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "location_description";