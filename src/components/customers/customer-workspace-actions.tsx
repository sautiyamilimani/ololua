"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CustomerDeleteControl } from "./customer-delete-control";
import { CustomerEditControl } from "./customer-edit-control";

type CustomerWorkspaceActionsProps = {
  canManage: boolean;
  customerId: string;
  customerType: "individual" | "business";
  fullName: string;
  phone: string;
  email: string;
  notes: string | null;
  status: "active" | "inactive";
  customerNumber: string;
  moreInformation: ReactNode;
};

export function CustomerWorkspaceTabs({
  canManage,
  customerId,
  customerType,
  fullName,
  phone,
  email,
  notes,
  status,
  moreInformation,
}: CustomerWorkspaceActionsProps) {
  const [activePanel, setActivePanel] = useState<"more" | "edit" | null>(null);

  useEffect(() => {
    function handleAction(event: Event) {
      const customEvent = event as CustomEvent<"more" | "edit">;
      if (customEvent.detail === "edit" && !canManage) return;
      setActivePanel(customEvent.detail);
    }

    window.addEventListener("customer-workspace-action", handleAction);
    return () =>
      window.removeEventListener("customer-workspace-action", handleAction);
  }, [canManage]);

  return (
    <>
      {activePanel === "more" && (
        <div className="mt-6 border-t border-slate-200 pt-5" role="region" aria-label="More information">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">More information</h2>
            <button
              aria-label="Close more information"
              className="flex size-10 items-center justify-center rounded-full text-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={() => setActivePanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          {moreInformation}
        </div>
      )}
      {activePanel === "edit" && canManage && (
        <div className="mt-6 border-t border-slate-200 pt-5" role="region" aria-label="Edit customer">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">Edit customer</h2>
            <button
              aria-label="Close edit customer"
              className="flex size-10 items-center justify-center rounded-full text-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={() => setActivePanel(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <CustomerEditControl
            customerId={customerId}
            customerType={customerType}
            email={email}
            fullName={fullName}
            notes={notes}
            phone={phone}
            status={status}
          />
        </div>
      )}
    </>
  );
}

export function CustomerWorkspaceMenu({
  canManage,
  customerId,
  customerName,
  customerNumber,
}: {
  canManage: boolean;
  customerId: string;
  customerName: string;
  customerNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-label="Customer actions"
        className="flex size-11 items-center justify-center rounded-full border border-slate-200 text-xl font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="pb-1 text-2xl leading-none">
          ⋮
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(18rem,calc(100vw-3rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="divide-y divide-slate-100">
            <button
              className="min-h-11 w-full text-left text-sm font-semibold text-slate-800"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("customer-workspace-action", {
                    detail: "more",
                  }),
                );
                setOpen(false);
              }}
              type="button"
            >
              More information
            </button>
            {canManage && (
              <button
                className="min-h-11 w-full text-left text-sm font-semibold text-slate-800"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("customer-workspace-action", {
                      detail: "edit",
                    }),
                  );
                  setOpen(false);
                }}
                type="button"
              >
                Edit customer
              </button>
            )}
          </div>
          {canManage && (
            <div className="mt-3 border-t border-red-100 pt-3">
              <p className="mb-2 text-xs leading-5 text-slate-600">
                Soft deletion keeps linked records and financial history unchanged.
              </p>
              <CustomerDeleteControl
                customerId={customerId}
                customerName={customerName}
                customerNumber={customerNumber}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
