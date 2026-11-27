"use client";

import {
  CustomerInvitationFlow,
  type CustomerInvitationOption,
} from "./customer-invitation-flow";

export function InviteCustomerForm({
  customers,
}: {
  customers: CustomerInvitationOption[];
}) {
  if (customers.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
        No customers without an active portal login are available to invite.
        Create a customer record first.
      </p>
    );
  }

  return <CustomerInvitationFlow customers={customers} />;
}
