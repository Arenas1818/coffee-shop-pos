"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import ManagementSidebar from "../management-sidebar";
import { useStoreSettings } from "@/lib/store-settings";

type PaymentSummary = {
  method: string;
  amountReceived: number;
  transactionCount: number;
};

type DailyOrders = {
  date: string;
  orders: number;
};

type SalesReport = {
  from: string;
  to: string;
  daysInPeriod: number;
  revenue: number;
  orderCount: number;
  averageOrdersPerDay: number;
  itemsSold: number;
  paymentMethods: PaymentSummary[];
  dailyOrders: DailyOrders[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateRange() {
  const today = new Date();
  return {
    from: localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localDateValue(today),
  };
}

function parseReport(value: unknown): SalesReport {
  if (
    !isRecord(value) ||
    typeof value.from_date !== "string" ||
    typeof value.to_date !== "string" ||
    !Array.isArray(value.payment_methods) ||
    !Array.isArray(value.daily_orders)
  ) {
    throw new Error("The sales report returned an invalid response.");
  }

  const daysInPeriod = Number(value.days_in_period);
  const revenue = Number(value.revenue);
  const orderCount = Number(value.order_count);
  const averageOrdersPerDay = Number(value.average_orders_per_day);
  const itemsSold = Number(value.items_sold);
  if (
    !Number.isFinite(daysInPeriod) ||
    !Number.isFinite(revenue) ||
    !Number.isFinite(orderCount) ||
    !Number.isFinite(averageOrdersPerDay) ||
    !Number.isFinite(itemsSold)
  ) {
    throw new Error("The sales report returned invalid totals.");
  }

  const paymentMethods = value.payment_methods.map((item): PaymentSummary => {
    if (!isRecord(item) || typeof item.method !== "string") {
      throw new Error("The sales report returned an invalid payment method.");
    }
    const amountReceived = Number(item.amount_received);
    const transactionCount = Number(item.transaction_count);
    if (!Number.isFinite(amountReceived) || !Number.isFinite(transactionCount)) {
      throw new Error("The sales report returned invalid payment totals.");
    }
    return { method: item.method, amountReceived, transactionCount };
  });

  const dailyOrders = value.daily_orders.map((item): DailyOrders => {
    if (!isRecord(item) || typeof item.date !== "string") {
      throw new Error("The sales report returned an invalid daily total.");
    }
    const orders = Number(item.orders);
    if (!Number.isFinite(orders)) {
      throw new Error("The sales report returned an invalid daily order count.");
    }
    return { date: item.date, orders };
  });

  return {
    from: value.from_date,
    to: value.to_date,
    daysInPeriod,
    revenue,
    orderCount,
    averageOrdersPerDay,
    itemsSold,
    paymentMethods,
    dailyOrders,
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const paymentMethodLabels: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  e_wallet: "E-wallet",
  unrecorded: "Not recorded",
};

export default function SalesReportsClient({
  role,
  email,
}: {
  role: "manager" | "admin";
  email: string;
}) {
  const { formatCurrency, settings } = useStoreSettings();
  const [initialRange] = useState(defaultDateRange);
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadReport = useCallback(async (from: string, to: string) => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const { data, error } = await createSupabaseBrowserClient().rpc(
        "manager_sales_report",
        { p_from: from, p_to: to },
      );
      if (error) throw error;
      setReport(parseReport(data));
    } catch (error) {
      setErrorMessage(
        isRecord(error) && typeof error.message === "string"
          ? error.message
          : String(error),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadReport(initialRange.from, initialRange.to);
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [initialRange.from, initialRange.to, loadReport]);

  function applyDateRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fromDate || !toDate || fromDate > toDate) {
      setErrorMessage("Choose a valid date range. The start date must not be after the end date.");
      return;
    }
    void loadReport(fromDate, toDate);
  }

  function downloadCsv() {
    if (!report) return;
    const rows: (string | number)[][] = [
      [`${settings.storeName} - SALES REPORT`],
      ["Date range", report.from, report.to],
      [],
      ["Summary"],
      [`Revenue (${settings.currencySymbol})`, report.revenue.toFixed(2)],
      ["Orders", report.orderCount],
      ["Average orders per day", report.averageOrdersPerDay.toFixed(2)],
      ["Items sold", report.itemsSold],
      [],
      ["Payment methods"],
      ["Payment method", "Transactions", `Amount received (${settings.currencySymbol})`],
      ...report.paymentMethods.map((payment) => [
        paymentMethodLabels[payment.method] ?? payment.method,
        payment.transactionCount,
        payment.amountReceived.toFixed(2),
      ]),
      [],
      ["Daily orders"],
      ["Date", "Orders"],
      ...report.dailyOrders.map((day) => [day.date, day.orders]),
    ];
    const csv = `\uFEFF${rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-report-${report.from}-to-${report.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const summaryCards = [
    { label: "Filtered revenue", value: formatCurrency(report?.revenue ?? 0) },
    { label: "Orders", value: String(report?.orderCount ?? 0) },
    {
      label: "Average orders per day",
      value: report?.averageOrdersPerDay.toFixed(2) ?? "0.00",
    },
    { label: "Items sold", value: String(report?.itemsSold ?? 0) },
  ];

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <header className="sales-report-screen-only border-b border-cafe-border bg-cafe-card shadow-[0_2px_12px_rgba(74,52,40,0.04)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cafe-espresso text-xl text-[#fffaf0]">
              ☕
            </div>
            <div>
              <p className="font-semibold tracking-tight text-cafe-espresso">
                {settings.storeName}
              </p>
              <p className="text-xs text-cafe-muted">Sales reports</p>
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium">{email}</p>
            <p className="text-xs capitalize text-cafe-muted">{role}</p>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <div className="sales-report-screen-only">
          <ManagementSidebar role={role} />
        </div>
        <div className="min-w-0 flex-1 px-0 py-2 sm:py-4 lg:px-8 lg:py-8">
          <section className="sales-report-screen-only mb-7 flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-[#eee5d7] px-6 py-7 sm:px-8 sm:py-9">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">
                MANAGEMENT WORKSPACE
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-cafe-espresso sm:text-4xl">
                Sales Reports
              </h1>
              <p className="mt-2 text-sm text-[#75695d]">
                Review sales totals and payment amounts for a selected date range.
              </p>
            </div>
          </section>

          <section className="sales-report-screen-only mb-6 rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)]">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={applyDateRange}
            >
              <div>
                <label
                  htmlFor="sales-report-from"
                  className="mb-1.5 block text-sm font-medium"
                >
                  From
                </label>
                <input
                  id="sales-report-from"
                  type="date"
                  required
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="h-11 rounded-lg border border-cafe-border bg-white px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="sales-report-to"
                  className="mb-1.5 block text-sm font-medium"
                >
                  To
                </label>
                <input
                  id="sales-report-to"
                  type="date"
                  required
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(event) => setToDate(event.target.value)}
                  className="h-11 rounded-lg border border-cafe-border bg-white px-3 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="h-11 rounded-lg bg-cafe-sage-dark px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {isLoading ? "Loading..." : "Apply dates"}
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={!report || isLoading}
                className="h-11 rounded-lg border border-cafe-border bg-[#f8f4ec] px-4 text-sm font-medium text-cafe-espresso disabled:opacity-60"
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!report || isLoading}
                className="h-11 rounded-lg border border-cafe-border bg-[#f8f4ec] px-4 text-sm font-medium text-cafe-espresso disabled:opacity-60"
              >
                Print / Save PDF
              </button>
            </form>
            <p className="mt-3 text-xs text-cafe-muted">
              Dates are interpreted in Philippines time (Asia/Manila).
            </p>
          </section>

          {errorMessage && (
            <div
              role="alert"
              className="sales-report-screen-only mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800"
            >
              <p className="font-semibold">Could not load the sales report.</p>
              <p className="mt-1">{errorMessage}</p>
              <p className="mt-2">
                Apply migration 20261013000700_sales_reports.sql in Supabase,
                then refresh this page.
              </p>
            </div>
          )}

          <div className="sales-report-print-target">
            <div className="mb-5 hidden print:block">
              <h1 className="text-2xl font-bold">{settings.storeName} · Sales Report</h1>
              <p className="mt-1 text-sm">
                Date range: {report?.from} to {report?.to} (Asia/Manila)
              </p>
            </div>
            <section
              aria-label="Sales summary"
              className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            >
              {summaryCards.map((card) => (
                <article
                  key={card.label}
                  className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] print:border-[#999] print:shadow-none"
                >
                  <p className="text-sm text-cafe-muted">{card.label}</p>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-cafe-espresso">
                    {isLoading ? "…" : card.value}
                  </p>
                </article>
              ))}
            </section>

            <section className="mb-6 rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] print:border-[#999] print:shadow-none">
              <h2 className="mb-1 text-lg font-semibold text-cafe-espresso">
                Amount received by payment method
              </h2>
              <p className="mb-4 text-sm text-cafe-muted">
                Includes the amount entered for cash payments before change.
              </p>
              {isLoading ? (
                <p role="status" className="py-5 text-sm text-cafe-muted">
                  Loading payment totals...
                </p>
              ) : report?.paymentMethods.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-cafe-border text-cafe-muted">
                        <th scope="col" className="py-3 pr-4 font-medium">
                          Payment method
                        </th>
                        <th scope="col" className="py-3 pr-4 text-right font-medium">
                          Transactions
                        </th>
                        <th scope="col" className="py-3 text-right font-medium">
                          Amount received
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cafe-border">
                      {report.paymentMethods.map((payment) => (
                        <tr key={payment.method}>
                          <th scope="row" className="py-3 pr-4 font-medium">
                            {paymentMethodLabels[payment.method] ?? payment.method}
                          </th>
                          <td className="py-3 pr-4 text-right">
                            {payment.transactionCount}
                          </td>
                          <td className="py-3 text-right font-semibold">
                            {formatCurrency(payment.amountReceived)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-5 text-sm text-cafe-muted">
                  No transactions in this date range.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] print:border-[#999] print:shadow-none">
              <h2 className="mb-1 text-lg font-semibold text-cafe-espresso">
                Orders per day
              </h2>
              <p className="mb-4 text-sm text-cafe-muted">
                Average: {report?.averageOrdersPerDay.toFixed(2) ?? "0.00"}{" "}
                orders per day over {report?.daysInPeriod ?? 0} calendar days.
              </p>
              {isLoading ? (
                <p role="status" className="py-5 text-sm text-cafe-muted">
                  Loading daily orders...
                </p>
              ) : report?.dailyOrders.length ? (
                <div className="max-h-80 overflow-auto print:max-h-none print:overflow-visible">
                  <table className="w-full min-w-[260px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-cafe-border text-cafe-muted">
                        <th scope="col" className="py-3 pr-4 font-medium">
                          Date
                        </th>
                        <th scope="col" className="py-3 text-right font-medium">
                          Orders
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cafe-border">
                      {report.dailyOrders.map((day) => (
                        <tr key={day.date}>
                          <th scope="row" className="py-3 pr-4 font-medium">
                            {day.date}
                          </th>
                          <td className="py-3 text-right">{day.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-5 text-sm text-cafe-muted">
                  No daily order details in this date range.
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
