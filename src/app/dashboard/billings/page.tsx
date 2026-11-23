import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export const metadata: Metadata = { title: "Billings | Ololua MIS" };

export default function BillingsPage() {
  return (
    <ComingSoon
      description="Billing history and payment summaries will be available in the next approved module."
      title="Billings coming soon"
    />
  );
}
