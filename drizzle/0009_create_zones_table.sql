CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_name" varchar(100) NOT NULL,
	"county" varchar(60),
	"town" varchar(60),
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_zone_name_unique" UNIQUE("zone_name"),
	CONSTRAINT "zones_latitude_check" CHECK ("zones"."latitude" is null or ("zones"."latitude" >= -90 and "zones"."latitude" <= 90)),
	CONSTRAINT "zones_longitude_check" CHECK ("zones"."longitude" is null or ("zones"."longitude" >= -180 and "zones"."longitude" <= 180))
);
