"use client";

import type { ChangeEvent } from "react";

type MeterDirectoryFilterProps = {
  searchTerm: string;
  statusFilter: "all" | "active" | "defective";
  assignmentFilter: "all" | "assigned" | "unassigned";
};

export function MeterDirectoryFilter({
  searchTerm,
  statusFilter,
  assignmentFilter,
}: MeterDirectoryFilterProps) {
  const submitForm = (event: ChangeEvent<HTMLSelectElement>) => {
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form action="/dashboard/meters" className="mb-6" method="get">
      <div className="flex gap-3">
        <label className="sr-only" htmlFor="meter-search">
          Search by serial number
        </label>
        <input
          autoComplete="off"
          className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          defaultValue={searchTerm}
          id="meter-search"
          maxLength={100}
          name="q"
          placeholder="Search serial number"
          type="search"
        />
        <button
          className="min-h-11 shrink-0 rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
          type="submit"
        >
          Search
        </button>
      </div>

      <div
        aria-label="Filter meters"
        className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3"
      >
        <label className="min-w-0 text-xs font-semibold text-slate-600">
          Status
          <select
            className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-800"
            defaultValue={statusFilter}
            name="status"
            onChange={submitForm}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="defective">Defective</option>
          </select>
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-600">
          Assignment
          <select
            className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium text-slate-800"
            defaultValue={assignmentFilter}
            name="assignment"
            onChange={submitForm}
          >
            <option value="all">All assignments</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
      </div>
    </form>
  );
}
