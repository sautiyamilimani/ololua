"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { CustomerInvitationFlow, type CustomerInvitationOption } from "@/components/auth/customer-invitation-flow";
import { StepProgress } from "@/components/step-progress";
import { useNotifications } from "@/components/notifications/notification-provider";

type CustomerFormValues = {
  customerType: "individual" | "business";
  fullName: string;
  phone: string;
  email: string;
  notes: string;
};

const INITIAL_VALUES: CustomerFormValues = {
  customerType: "individual",
  fullName: "",
  phone: "",
  email: "",
  notes: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return "We could not verify the response. Please try again.";
  }
  const code = payload.error.code;
  if (code === "UNAUTHENTICATED") {
    return "Your session has expired. Sign in again.";
  }
  if (code === "FORBIDDEN") {
    return "You do not have permission to manage customers.";
  }
  if (code === "CUSTOMER_CONFLICT") {
    return "A customer with that email already exists or the email is still restricted.";
  }
  if (code === "CSRF_FAILED") {
    return "For your security, reload this page and try again.";
  }
  if (code === "VALIDATION_ERROR") {
    return "Check the required fields and try again.";
  }
  return "The customer could not be saved.";
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function CustomerCreateForm({
  canInviteCustomers,
}: {
  canInviteCustomers: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<CustomerFormValues>(INITIAL_VALUES);
  const [step, setStep] = useState(1);
  const [inviteAfterCreate, setInviteAfterCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invitationCustomer, setInvitationCustomer] =
    useState<CustomerInvitationOption | null>(null);
  const notifications = useNotifications();

  function updateField<Field extends keyof CustomerFormValues>(
    field: Field,
    value: CustomerFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function continueToNextStep() {
    if (!formRef.current?.reportValidity()) return;
    setStep((current) => Math.min(current + 1, 3));
  }

  function returnToPreviousStep() {
    setStep((current) => Math.max(current - 1, 1));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || step !== 3) return;
    if (!formRef.current?.reportValidity()) return;

    setSubmitting(true);

    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify({
          customerType: values.customerType,
          fullName: values.fullName,
          phone: values.phone,
          email: values.email,
          notes: values.notes.trim() || null,
        }),
      });
      const payload = await readPayload(response);

      if (!response.ok) {
        notifications.error(getErrorMessage(payload));
        return;
      }

      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data) ||
        !isRecord(payload.data.customer) ||
        typeof payload.data.customer.id !== "string" ||
        typeof payload.data.customer.customerNumber !== "string"
      ) {
        notifications.error(
          "The customer may have been created, but we could not start the next step. Check the customer list before trying again.",
        );
        return;
      }

      notifications.success("Customer created successfully.");
      if (inviteAfterCreate && canInviteCustomers) {
        setInvitationCustomer({
          id: payload.data.customer.id,
          customerNumber: payload.data.customer.customerNumber,
          fullName: values.fullName.trim(),
          email: values.email.trim().toLowerCase(),
        });
        router.refresh();
        return;
      }

      router.push(
        `/dashboard/accounts/customers/${payload.data.customer.id}`,
      );
      router.refresh();
    } catch {
      notifications.error(
        "We could not confirm whether the customer was created. Check the customer list before trying again.",
        true,
      );
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 shadow-sm outline-none transition focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15";

  if (invitationCustomer) {
    return (
      <div className="space-y-5">
        <CustomerInvitationFlow
          autoStart
          customers={[invitationCustomer]}
          initialCustomerId={invitationCustomer.id}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepProgress
        currentStep={step - 1}
        label="Customer registration progress"
        steps={["Name and email", "Customer details", "Review and invite"]}
      />

      <form
        className="space-y-5"
        onSubmit={(event) => void handleSubmit(event)}
        ref={formRef}
      >
        {step === 1 && (
          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-slate-950">
              Customer identity
            </legend>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="fullName">
                Full name
              </label>
              <input
                autoComplete="name"
                className={fieldClass}
                id="fullName"
                maxLength={150}
                onChange={(event) => updateField("fullName", event.currentTarget.value)}
                required
                value={values.fullName}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="email">
                Email address
              </label>
              <input
                autoComplete="email"
                className={fieldClass}
                id="email"
                maxLength={254}
                onChange={(event) => updateField("email", event.currentTarget.value)}
                required
                type="email"
                value={values.email}
              />
              <p className="mt-2 text-sm text-slate-600">
                Creating a customer does not create a portal login or verify this email.
              </p>
            </div>
          </fieldset>
        )}

        {step === 2 && (
          <fieldset className="grid gap-5 sm:grid-cols-2">
            <legend className="mb-1 text-base font-semibold text-slate-950 sm:col-span-2">
              Customer details
            </legend>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="customerType">
                Customer type
              </label>
              <select
                className={fieldClass}
                id="customerType"
                onChange={(event) =>
                  updateField(
                    "customerType",
                    event.currentTarget.value === "business"
                      ? "business"
                      : "individual",
                  )
                }
                value={values.customerType}
              >
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="phone">
                Phone number
              </label>
              <input
                autoComplete="tel"
                className={fieldClass}
                id="phone"
                maxLength={20}
                onChange={(event) => updateField("phone", event.currentTarget.value)}
                required
                value={values.phone}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="notes">
                Notes
              </label>
              <textarea
                className="block min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2.5"
                id="notes"
                onChange={(event) => updateField("notes", event.currentTarget.value)}
                value={values.notes}
              />
            </div>
          </fieldset>
        )}

        {step === 3 && (
          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-slate-950">
              Review customer record
            </legend>
            <dl className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Name</dt>
                <dd className="font-medium text-slate-950">{values.fullName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Email</dt>
                <dd className="font-medium text-slate-950">{values.email}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Customer type</dt>
                <dd className="font-medium capitalize text-slate-950">{values.customerType}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Phone</dt>
                <dd className="font-medium text-slate-950">{values.phone}</dd>
              </div>
              {values.notes.trim() && (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Notes</dt>
                  <dd className="font-medium text-slate-950">{values.notes}</dd>
                </div>
              )}
            </dl>

            {canInviteCustomers ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
                <input
                  checked={inviteAfterCreate}
                  className="mt-1 size-4 accent-teal-800"
                  onChange={(event) => setInviteAfterCreate(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm font-semibold text-teal-950">
                    Invite customer to a portal account
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-teal-900">
                    We will create the customer first, then request an email
                    verification code. After the code is confirmed, the invitation
                    is created and emailed automatically.
                  </span>
                </span>
              </label>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-5 text-slate-600">
                This customer will be created without a portal account. You can
                invite them later if you have invitation permission.
              </p>
            )}
          </fieldset>
        )}

        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-4">
          {step > 1 ? (
            <button
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={submitting}
              onClick={returnToPreviousStep}
              type="button"
            >
              Back
            </button>
          ) : (
            <span />
          )}

          {step < 3 ? (
            <button
              className="min-h-11 rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900"
              onClick={continueToNextStep}
              type="button"
            >
              Continue
            </button>
          ) : (
            <button
              className="min-h-11 rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {submitting
                ? "Creating customer..."
                : inviteAfterCreate && canInviteCustomers
                  ? "Create customer and start invitation"
                  : "Create customer"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
