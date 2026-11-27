import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { SmsTemplateForm } from "@/components/settings/sms-template-form";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export const metadata: Metadata = {
  title: "Settings | Ololua Water Services",
};

const settingKeys = [
  "invoice_due_days",
  "sms_payment_reminder_template",
  "sms_payment_confirmation_template",
  "sms_new_bill_template",
  "sms_announcement_template",
] as const;

export default async function SettingsPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(token)) redirect("/sign-in");
  const session = await getActiveSession(token);
  if (!session) redirect("/sign-in");
  if (
    session.user.accountType !== "staff" ||
    !session.canManageStaffAccounts
  ) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Settings</h1>
        <p className="mt-3 text-sm text-slate-600">
          Only administrators and superadministrators can manage settings.
        </p>
      </section>
    );
  }

  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...settingKeys]));
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings" },
        ]}
      />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <header className="mb-6">
          <p className="mb-2 text-sm font-semibold text-teal-800">Administration</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            Billing and SMS settings
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Edit billing and customer notification wording. SMS delivery is not enabled yet.
          </p>
        </header>
        <SmsTemplateForm
          initialSettings={{
            invoiceDueDays: Number(values.get("invoice_due_days") ?? "14"),
            paymentReminderTemplate:
              values.get("sms_payment_reminder_template") ?? "",
            paymentConfirmationTemplate:
              values.get("sms_payment_confirmation_template") ?? "",
            newBillTemplate:
              values.get("sms_new_bill_template") ?? "",
            announcementTemplate:
              values.get("sms_announcement_template") ?? "",
          }}
        />
      </div>
    </section>
  );
}
