ALTER TABLE "customer_account_credit_transfers" ADD COLUMN "sender_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "customer_account_credit_transfers" ADD COLUMN "recipient_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "customer_account_credit_transfers" ADD CONSTRAINT "customer_account_credit_transfers_sender_token_hash_unique" UNIQUE("sender_token_hash");--> statement-breakpoint
ALTER TABLE "customer_account_credit_transfers" ADD CONSTRAINT "customer_account_credit_transfers_recipient_token_hash_unique" UNIQUE("recipient_token_hash");