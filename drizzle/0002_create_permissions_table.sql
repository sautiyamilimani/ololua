CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permission_key" varchar(100) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"description" text,
	"module" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_permission_key_unique" UNIQUE("permission_key")
);
