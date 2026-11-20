CREATE TABLE "service_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_code" varchar(30) NOT NULL,
	"service_name" varchar(100) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_types_service_code_unique" UNIQUE("service_code"),
	CONSTRAINT "service_types_service_name_unique" UNIQUE("service_name"),
	CONSTRAINT "service_types_status_check" CHECK ("service_types"."status" in ('ACTIVE', 'INACTIVE'))
);
