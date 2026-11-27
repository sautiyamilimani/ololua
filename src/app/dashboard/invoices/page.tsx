import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export const metadata: Metadata = { title: "Invoices | Ololua MIS" };

export const instant = false;

export default function InvoicesPage() {
  return (
    <ComingSoon
      description="Invoice review and management will be available in the next approved module."
      title="Invoices coming soon"
    />
  );
}
