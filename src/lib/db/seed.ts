import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { roles } from "./schema/roles";
import { permissions } from "./schema/permissions";
import { rolePermissions } from "./schema/role-permissions";
import { zones } from "./schema/zones";
import { serviceTypes } from "./schema/service-types";
import { unitsOfMeasure } from "./schema/units-of-measure";
import { serviceVariants } from "./schema/service-variants";
import { serviceTariffs } from "./schema/service-tariffs";
import { customers } from "./schema/customers";
import { customerMeterAccounts } from "./schema/customer-meter-accounts";
import { meters } from "./schema/meters";
import { meterAssignments } from "./schema/meter-assignments";
import { settings } from "./schema/settings";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const localConnectionString = databaseUrl.includes("sslmode=")
  ? databaseUrl.replace(/sslmode=[^&]+/, "sslmode=disable")
  : `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}sslmode=disable`;
const pool = new Pool({ connectionString: localConnectionString, ssl: false });
const db = drizzle(pool, { schema });

async function seed() {
  await db.insert(settings).values([
    {
      key: "invoice_due_days",
      value: "14",
      description: "Number of calendar days from invoice issue to due date",
    },
    {
      key: "sms_payment_reminder_template",
      value: "Dear {customerName}, your meter {meterNumber} has an outstanding balance of KES {amountDue}. Please pay on or before {dueDate} to avoid disconnection.",
      description: "SMS template for payment reminders",
    },
    {
      key: "sms_payment_confirmation_template",
      value: "Dear {customerName}, we received KES {amountPaid} for meter {meterNumber}. Reference: {paymentReference}. Outstanding balance: KES {balanceDue}. Thank you.",
      description: "SMS template for payment confirmations",
    },
    {
      key: "sms_new_bill_template",
      value: "Previous reading {previousReading}; Current reading {currentReading}; Consumption {consumption}; Bill {billAmount}; Pay on or before {dueDate} to avoid disconnection.",
      description: "SMS template for newly issued bills",
    },
    {
      key: "sms_announcement_template",
      value: "Ololua Water Services notice: {announcementText}",
      description: "SMS template for outages, price changes, and other announcements",
    },
  ]).onConflictDoNothing();
  await db
    .update(settings)
    .set({
      value: "14",
      description: "Number of calendar days from invoice issue to due date",
    })
    .where(eq(settings.key, "invoice_due_days"));
  await db.insert(roles).values([
    { roleKey: "admin", displayName: "Administrator", isSystemRole: true },
    { roleKey: "customer", displayName: "Customer", isSystemRole: true },
    { roleKey: "superadmin", displayName: "Superadministrator", isSystemRole: true },
    { roleKey: "billing_officer", displayName: "Billing Officer", isSystemRole: false },
    { roleKey: "meter_reader", displayName: "Meter Reader", isSystemRole: false },
  ]).onConflictDoNothing();

  await db.insert(permissions).values([
    { permissionKey: "customers.read", displayName: "Read Customers", module: "customers" },
    { permissionKey: "customers.manage", displayName: "Manage Customers", module: "customers" },
    { permissionKey: "invitations.create_customer", displayName: "Invite Customer Users", module: "invitations" },
    { permissionKey: "readings.submit", displayName: "Submit Meter Readings", module: "meter_readings" },
    { permissionKey: "payments.record", displayName: "Record Payments", module: "payments" },
    { permissionKey: "meters.read", displayName: "Read Meters", module: "meters" },
    { permissionKey: "meters.manage", displayName: "Manage Meters", module: "meters" },
  ]).onConflictDoNothing();

  const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.roleKey, "admin")).limit(1);
  const [superadminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.roleKey, "superadmin")).limit(1);
  const [billingOfficerRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.roleKey, "billing_officer")).limit(1);
  const [meterReaderRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.roleKey, "meter_reader")).limit(1);
  const [readCustomersPermission] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.permissionKey, "customers.read")).limit(1);
  const [manageCustomersPermission] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.permissionKey, "customers.manage")).limit(1);
  const [submitReadingsPermission] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.permissionKey, "readings.submit")).limit(1);
  const [recordPaymentsPermission] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.permissionKey, "payments.record")).limit(1);
  const [readMetersPermission] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.permissionKey, "meters.read")).limit(1);
  const [manageMetersPermission] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.permissionKey, "meters.manage")).limit(1);

  if (
    !adminRole ||
    !superadminRole ||
    !billingOfficerRole ||
    !meterReaderRole ||
    !readCustomersPermission ||
    !manageCustomersPermission ||
    !submitReadingsPermission ||
    !recordPaymentsPermission ||
    !readMetersPermission ||
    !manageMetersPermission
  ) {
    throw new Error("Seed role or permission lookup failed.");
  }

  await db.insert(rolePermissions).values([
    { roleId: adminRole.id, permissionId: readCustomersPermission.id },
    { roleId: superadminRole.id, permissionId: readCustomersPermission.id },
    { roleId: billingOfficerRole.id, permissionId: readCustomersPermission.id },
    { roleId: meterReaderRole.id, permissionId: readCustomersPermission.id },
    { roleId: adminRole.id, permissionId: readMetersPermission.id },
    { roleId: superadminRole.id, permissionId: readMetersPermission.id },
    { roleId: billingOfficerRole.id, permissionId: readMetersPermission.id },
    { roleId: meterReaderRole.id, permissionId: readMetersPermission.id },
    { roleId: adminRole.id, permissionId: manageCustomersPermission.id },
    { roleId: superadminRole.id, permissionId: manageCustomersPermission.id },
    { roleId: superadminRole.id, permissionId: manageMetersPermission.id },
    { roleId: adminRole.id, permissionId: manageMetersPermission.id },
    { roleId: adminRole.id, permissionId: submitReadingsPermission.id },
    { roleId: adminRole.id, permissionId: recordPaymentsPermission.id },
  ]).onConflictDoNothing();

  await db.insert(zones).values({
    zoneName: "Ololua Central",
    county: "Kajiado",
    town: "Ngong",
    latitude: "-1.352600",
    longitude: "36.669700",
  }).onConflictDoNothing();

  await db.insert(serviceTypes).values({
    serviceCode: "WATER",
    serviceName: "Water Supply",
    description: "Metered water supply service",
    status: "ACTIVE",
  }).onConflictDoNothing();

  await db.insert(unitsOfMeasure).values({
    unitCode: "M3",
    unitName: "Cubic metre",
    description: "Volume in cubic metres",
  }).onConflictDoNothing();

  const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.zoneName, "Ololua Central")).limit(1);
  const [serviceType] = await db.select({ id: serviceTypes.id }).from(serviceTypes).where(eq(serviceTypes.serviceCode, "WATER")).limit(1);
  const [unit] = await db.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(eq(unitsOfMeasure.unitCode, "M3")).limit(1);

  if (!zone || !serviceType || !unit) {
    throw new Error("Seed zone or service lookup failed.");
  }

  await db.insert(serviceVariants).values({
    serviceTypeId: serviceType.id,
    unitId: unit.id,
    variantCode: "DOMESTIC_WATER",
    variantName: "Domestic Metered Water",
    status: "ACTIVE",
  }).onConflictDoNothing();

  const [variant] = await db.select({ id: serviceVariants.id }).from(serviceVariants).where(eq(serviceVariants.variantCode, "DOMESTIC_WATER")).limit(1);
  if (!variant) {
    throw new Error("Seed service variant lookup failed.");
  }

  const [existingTariff] = await db.select({ id: serviceTariffs.id })
    .from(serviceTariffs)
    .where(and(
      eq(serviceTariffs.serviceVariantId, variant.id),
      eq(serviceTariffs.status, "ACTIVE"),
    ))
    .limit(1);

  if (!existingTariff) {
    await db.insert(serviceTariffs).values({
      serviceVariantId: variant.id,
      rate: "50.00",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
      status: "ACTIVE",
    });
  }

  await db.insert(customers).values({
    customerNumber: "DEV-0001",
    customerType: "individual",
    fullName: "Development Customer",
    phone: "0700000000",
    email: "dev.customer@example.test",
    status: "active",
  }).onConflictDoNothing();

  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.customerNumber, "DEV-0001")).limit(1);
  if (!customer) {
    throw new Error("Seed customer lookup failed.");
  }

  await db.insert(customerMeterAccounts).values({
    accountNumber: "DEV-ACC-001",
    customerId: customer.id,
    serviceVariantId: variant.id,
    zoneId: zone.id,
    status: "ACTIVE",
  }).onConflictDoNothing();

  await db.insert(meters).values({
    serialNumber: "DEV-METER-001",
    status: "ACTIVE",
  }).onConflictDoNothing();

  const [account] = await db.select({ id: customerMeterAccounts.id }).from(customerMeterAccounts).where(eq(customerMeterAccounts.accountNumber, "DEV-ACC-001")).limit(1);
  const [meter] = await db.select({ id: meters.id }).from(meters).where(eq(meters.serialNumber, "DEV-METER-001")).limit(1);
  if (!account || !meter) {
    throw new Error("Seed account or meter lookup failed.");
  }

  const [activeAssignment] = await db.select({ id: meterAssignments.id })
    .from(meterAssignments)
    .where(and(
      eq(meterAssignments.meterId, meter.id),
      isNull(meterAssignments.removedAt),
    ))
    .limit(1);

  if (!activeAssignment) {
    await db.insert(meterAssignments).values({
      meterId: meter.id,
      customerMeterAccountId: account.id,
      initialReading: "0.000",
      assignedAt: new Date(),
    });
  }

  console.log("Development seed completed.");
}

seed()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
