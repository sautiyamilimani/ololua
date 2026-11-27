import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export const metadata: Metadata = { title: "Meter readings | Ololua MIS" };

export const instant = false;

export default function MeterReadingsPage() {
  return (
    <ComingSoon
      description="Meter reading submission and review will be available in the next approved module."
      title="Meter readings coming soon"
    />
  );
}
