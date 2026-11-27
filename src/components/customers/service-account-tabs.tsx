"use client";

import { useState, type ReactNode } from "react";

type ServiceAccountTab = "domestic" | "tankered" | "bottled";

export function ServiceAccountTabs({
  domestic,
  tankered,
  bottled,
  domesticCreate,
  tankeredCreate,
  bottledCreate,
  domesticCount,
  tankeredCount,
  bottledCount,
}: {
  domestic: ReactNode;
  tankered: ReactNode;
  bottled: ReactNode;
  domesticCreate: ReactNode;
  tankeredCreate: ReactNode;
  bottledCreate: ReactNode;
  domesticCount: number;
  tankeredCount: number;
  bottledCount: number;
}) {
  const [activeTab, setActiveTab] = useState<ServiceAccountTab>("domestic");
  const tabs: Array<{
    key: ServiceAccountTab;
    label: string;
    count: number;
  }> = [
    { key: "domestic", label: "DOMESTIC WATER", count: domesticCount },
    { key: "tankered", label: "TANKERED", count: tankeredCount },
    { key: "bottled", label: "BOTTLED", count: bottledCount },
  ];

  return (
    <div className="mt-5">
      <div
        aria-label="Service account types"
        className="grid grid-cols-3 gap-1 border-b border-slate-200"
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.key}
            className={`min-h-12 border-b-2 px-2 text-xs font-bold tracking-wide transition sm:text-sm ${
              activeTab === tab.key
                ? "border-teal-800 text-teal-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
            key={`service-account-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            type="button"
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pt-4" role="tabpanel">
        {activeTab === "domestic" && (
          <>
            {domesticCount > 0 ? (
              domestic
            ) : (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                No domestic water service accounts have been recorded for this customer.
              </p>
            )}
            {domesticCreate}
          </>
        )}
        {activeTab === "tankered" && (
          <>
            {tankeredCount > 0 ? (
              tankered
            ) : (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                No tanker delivery service accounts have been recorded for this customer.
              </p>
            )}
            {tankeredCreate}
          </>
        )}
        {activeTab === "bottled" && (
          <>
            {bottledCount > 0 ? (
              bottled
            ) : (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                No bottled water service accounts have been recorded for this customer.
              </p>
            )}
            {bottledCreate}
          </>
        )}
      </div>
    </div>
  );
}
