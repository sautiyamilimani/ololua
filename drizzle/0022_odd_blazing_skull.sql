ALTER TABLE "customer_user_access" DROP CONSTRAINT "customer_user_access_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_user_access" ADD CONSTRAINT "customer_user_access_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;