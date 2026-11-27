ALTER TABLE "meter_assignments" ADD COLUMN "location_description" text;--> statement-breakpoint
WITH active_assignments AS (
  SELECT
    assignment.id AS assignment_id,
    account.location_description AS account_location,
    row_number() OVER (
      PARTITION BY account.id
      ORDER BY assignment.assigned_at, assignment.id
    ) AS assignment_number
  FROM customer_meter_accounts AS account
  INNER JOIN meter_assignments AS assignment
    ON assignment.customer_meter_account_id = account.id
  WHERE assignment.removed_at IS NULL
)
UPDATE meter_assignments AS assignment
SET location_description = CASE
  WHEN active_assignments.assignment_number = 1
    THEN active_assignments.account_location
  ELSE 'to be specified'
END
FROM active_assignments
WHERE assignment.id = active_assignments.assignment_id;--> statement-breakpoint
ALTER TABLE "customer_meter_accounts" DROP COLUMN "property_address";--> statement-breakpoint
ALTER TABLE "customer_meter_accounts" DROP COLUMN "location_description";