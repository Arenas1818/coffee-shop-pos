"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import ManagementSidebar from "../management-sidebar";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type AttendanceShift = {
  id: string;
  staff_email: string;
  clock_in_at: string;
  clock_out_at: string | null;
  seconds_worked: number;
  clock_in_by_email: string;
  clock_out_by_email: string | null;
};

type AttendanceReport = {
  from_date: string;
  to_date: string;
  shifts: AttendanceShift[];
};

function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseReport(data: unknown): AttendanceReport {
  if (typeof data !== "object" || data === null || !("shifts" in data)) {
    throw new Error("The attendance report response is invalid.");
  }
  const value = data as Record<string, unknown>;
  if (!Array.isArray(value.shifts)) {
    throw new Error("The attendance report did not contain a shift list.");
  }
  const shifts = value.shifts.map((row: unknown): AttendanceShift => {
    if (typeof row !== "object" || row === null) {
      throw new Error("The attendance report contains an invalid shift.");
    }
    const shift = row as Record<string, unknown>;
    if (
      typeof shift.id !== "string" ||
      typeof shift.staff_email !== "string" ||
      typeof shift.clock_in_at !== "string" ||
      (shift.clock_out_at !== null && typeof shift.clock_out_at !== "string") ||
      typeof shift.seconds_worked !== "number" ||
      typeof shift.clock_in_by_email !== "string" ||
      (shift.clock_out_by_email !== null &&
        typeof shift.clock_out_by_email !== "string")
    ) {
      throw new Error("The attendance report contains invalid shift details.");
    }
    return shift as AttendanceShift;
  });
  return {
    from_date: String(value.from_date ?? ""),
    to_date: String(value.to_date ?? ""),
    shifts,
  };
}

function errorText(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid time";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export default function AttendanceClient({
  role,
}: {
  role: "manager" | "admin";
}) {
  const [today] = useState(manilaToday);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadReport = useCallback(async (from: string, to: string) => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const { data, error } = await createSupabaseBrowserClient().rpc(
        "manager_attendance_report",
        { p_from: from, p_to: to },
      );
      if (error) throw error;
      setReport(parseReport(data));
    } catch (error) {
      setErrorMessage(errorText(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadReport(today, today);
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadReport, today]);

  function applyDateRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fromDate || !toDate || fromDate > toDate) {
      setErrorMessage("Choose a valid date range.");
      return;
    }
    void loadReport(fromDate, toDate);
  }

  function exportCsv() {
    if (!report) return;
    const rows = [
      ["Employee", "Clock in (Manila)", "Clock out (Manila)", "Duration", "Clocked in by", "Clocked out by"],
      ...report.shifts.map((shift) => [
        shift.staff_email,
        formatDateTime(shift.clock_in_at),
        formatDateTime(shift.clock_out_at),
        formatDuration(shift.seconds_worked),
        shift.clock_in_by_email,
        shift.clock_out_by_email ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `attendance-${report.from_date}-to-${report.to_date}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:min-h-screen lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <ManagementSidebar role={role} />
        <div className="min-w-0 flex-1 px-0 py-2 lg:px-8 lg:py-8">
          <header className="mb-7">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">KAPE NA NAMAN</p>
            <h1 className="text-3xl font-semibold tracking-tight text-cafe-espresso">Staff attendance</h1>
            <p className="mt-2 text-sm text-cafe-muted">Review PIN-based clock in/out records. Times are shown in Philippines time.</p>
          </header>

          {errorMessage && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</p>}

          <section className="mb-6 rounded-2xl border border-cafe-border bg-cafe-card p-5">
            <form onSubmit={applyDateRange} className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="attendance-from" className="mb-1 block text-sm font-medium">From</label>
                <input id="attendance-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-11 rounded-lg border border-cafe-border bg-white px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="attendance-to" className="mb-1 block text-sm font-medium">To</label>
                <input id="attendance-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-11 rounded-lg border border-cafe-border bg-white px-3 text-sm" />
              </div>
              <button type="submit" disabled={isLoading} className="h-11 rounded-xl bg-cafe-sage-dark px-5 text-sm font-medium text-white hover:bg-[#43563d] disabled:opacity-60">{isLoading ? "Loading..." : "Apply dates"}</button>
              <button type="button" onClick={exportCsv} disabled={!report || report.shifts.length === 0} className="h-11 rounded-xl border border-cafe-border px-5 text-sm font-medium hover:bg-cafe-surface-soft disabled:opacity-50">Export CSV</button>
            </form>
          </section>

          <section className="overflow-hidden rounded-2xl border border-cafe-border bg-cafe-card">
            <div className="flex items-center justify-between gap-3 border-b border-cafe-border px-5 py-4">
              <h2 className="font-semibold text-cafe-espresso">Clock records</h2>
              <span className="text-sm text-cafe-muted">{report?.shifts.length ?? 0} shifts</span>
            </div>
            {isLoading ? (
              <p role="status" className="p-6 text-sm text-cafe-muted">Loading attendance...</p>
            ) : report?.shifts.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-cafe-surface-soft text-xs uppercase tracking-wide text-cafe-muted">
                    <tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Clock in</th><th className="px-5 py-3">Clock out</th><th className="px-5 py-3">Duration</th><th className="px-5 py-3">Clock in by</th><th className="px-5 py-3">Clock out by</th></tr>
                  </thead>
                  <tbody className="divide-y divide-cafe-border">
                    {report.shifts.map((shift) => (
                      <tr key={shift.id}>
                        <td className="px-5 py-4 font-medium">{shift.staff_email}</td>
                        <td className="px-5 py-4">{formatDateTime(shift.clock_in_at)}</td>
                        <td className="px-5 py-4">{shift.clock_out_at ? formatDateTime(shift.clock_out_at) : <span className="font-medium text-cafe-sage-dark">On shift</span>}</td>
                        <td className="px-5 py-4">{formatDuration(shift.seconds_worked)}</td>
                        <td className="px-5 py-4">{shift.clock_in_by_email}</td>
                        <td className="px-5 py-4">{shift.clock_out_by_email ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-6 text-sm text-cafe-muted">No attendance records for these dates.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
