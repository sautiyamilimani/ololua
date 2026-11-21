CREATE TABLE "superadmin_assignments" (
	"singleton_key" boolean DEFAULT true NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "superadmin_assignments_singleton_key_pk" PRIMARY KEY("singleton_key"),
	CONSTRAINT "superadmin_assignments_singleton_key_check" CHECK ("superadmin_assignments"."singleton_key" is true)
);
--> statement-breakpoint
ALTER TABLE "superadmin_assignments" ADD CONSTRAINT "superadmin_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superadmin_assignments" ADD CONSTRAINT "superadmin_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "superadmin_assignments" ("singleton_key", "user_id", "role_id")
SELECT true, "user_roles"."user_id", "user_roles"."role_id"
FROM "user_roles"
INNER JOIN "roles" ON "roles"."id" = "user_roles"."role_id"
WHERE "roles"."role_key" = 'superadmin';--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_single_superadmin_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_role_key varchar(50);
  new_role_key varchar(50);
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "role_key" INTO old_role_key
    FROM "roles"
    WHERE "id" = OLD."role_id";

    IF old_role_key = 'superadmin' THEN
      DELETE FROM "superadmin_assignments"
      WHERE "singleton_key" IS TRUE
        AND "user_id" = OLD."user_id"
        AND "role_id" = OLD."role_id";
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT "role_key" INTO old_role_key
    FROM "roles"
    WHERE "id" = OLD."role_id";

    IF old_role_key = 'superadmin'
      AND (OLD."user_id" IS DISTINCT FROM NEW."user_id"
        OR OLD."role_id" IS DISTINCT FROM NEW."role_id") THEN
      DELETE FROM "superadmin_assignments"
      WHERE "singleton_key" IS TRUE
        AND "user_id" = OLD."user_id"
        AND "role_id" = OLD."role_id";
    END IF;
  END IF;

  SELECT "role_key" INTO new_role_key
  FROM "roles"
  WHERE "id" = NEW."role_id";

  IF new_role_key = 'superadmin' THEN
    INSERT INTO "superadmin_assignments" ("singleton_key", "user_id", "role_id")
    VALUES (true, NEW."user_id", NEW."role_id")
    ON CONFLICT ("singleton_key") DO UPDATE
      SET "user_id" = EXCLUDED."user_id",
          "role_id" = EXCLUDED."role_id"
      WHERE "superadmin_assignments"."user_id" = EXCLUDED."user_id"
        AND "superadmin_assignments"."role_id" = EXCLUDED."role_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only one superadmin role assignment is allowed.'
        USING ERRCODE = '23505',
          CONSTRAINT = 'superadmin_assignments_singleton_key_pk';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_roles_enforce_single_superadmin
BEFORE INSERT OR UPDATE OR DELETE ON "user_roles"
FOR EACH ROW
EXECUTE FUNCTION enforce_single_superadmin_assignment();--> statement-breakpoint
COMMENT ON FUNCTION enforce_single_superadmin_assignment() IS
'Synchronizes superadmin role assignments with a singleton row; its primary key rejects concurrent duplicate assignments.';