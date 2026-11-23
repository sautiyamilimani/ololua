import type { Metadata } from "next";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export const metadata: Metadata = { title: "Usage | Ololua MIS" };

export default function UsagePage() {
  return (
    <ComingSoon
      description="Your water usage and consumption history will be available in the next approved module."
      title="Usage coming soon"
    />
  );
}
