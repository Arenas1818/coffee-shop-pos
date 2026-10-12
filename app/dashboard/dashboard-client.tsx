"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { currency } from "@/lib/currency";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import ManagementSidebar from "../management-sidebar";

type TopProduct = {
  id: string;
  name: string;
  quantity: number;
  sales: number;
};

type RecentOrder = {
  id: string;
  total: number;
  createdAt: string;
  items: { name: string; variant: string | null; quantity: number }[];
};

type SalesDay = { date: string; sales: number; cost: number; orders: number };
type LowStockItem = {
  id: string;
  name: string;
  quantity: number;
  threshold: number;
  unit: string;
};
type RefundableOrder = {
  id: string;
  total: number;
  refunded: number;
  remaining: number;
};

type DashboardMetrics = {
  orderCount: number;
  revenue: number;
  refunds: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  uncostedItems: number;
  itemsSold: number;
  salesByDay: SalesDay[];
  topProducts: TopProduct[];
  recentOrders: RecentOrder[];
  refundableOrders: RefundableOrder[];
  lowStock: LowStockItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMetrics(value: unknown): DashboardMetrics {
  if (!isRecord(value)) {
    throw new Error("The dashboard returned an invalid response.");
  }

  const orderCount = Number(value.order_count);
  const revenue = Number(value.revenue);
  const refunds = Number(value.refunds);
  const costOfGoodsSold = Number(value.cost_of_goods_sold);
  const grossProfit = Number(value.gross_profit);
  const expenses = Number(value.expenses);
  const netProfit = Number(value.net_profit);
  const uncostedItems = Number(value.uncosted_items);
  const itemsSold = Number(value.items_sold);
  if (
    !Number.isFinite(orderCount) ||
    !Number.isFinite(revenue) ||
    !Number.isFinite(refunds) ||
    !Number.isFinite(costOfGoodsSold) ||
    !Number.isFinite(grossProfit) ||
    !Number.isFinite(expenses) ||
    !Number.isFinite(netProfit) ||
    !Number.isFinite(uncostedItems) ||
    !Number.isFinite(itemsSold) ||
    !Array.isArray(value.sales_by_day) ||
    !Array.isArray(value.top_products) ||
    !Array.isArray(value.recent_orders) ||
    !Array.isArray(value.refundable_orders) ||
    !Array.isArray(value.low_stock)
  ) {
    throw new Error("The dashboard returned invalid metric values.");
  }

  const salesByDay = value.sales_by_day.map((item): SalesDay => {
    if (!isRecord(item)) throw new Error("The dashboard returned an invalid sales day.");
    const sales = Number(item.sales);
    const cost = Number(item.cost);
    const orders = Number(item.orders);
    if (item.cost === undefined || item.cost === null) {
      throw new Error(
        "Daily ingredient-cost data is missing. Run the product recipe and inventory cost migration.",
      );
    }
    if (
      typeof item.date !== "string" ||
      !Number.isFinite(sales) ||
      !Number.isFinite(cost) ||
      !Number.isFinite(orders)
    ) {
      throw new Error("The dashboard returned invalid sales day values.");
    }
    return { date: item.date, sales, cost, orders };
  });

  const topProducts = value.top_products.map((item): TopProduct => {
    if (!isRecord(item)) throw new Error("The dashboard returned an invalid product.");
    const quantity = Number(item.quantity);
    const sales = Number(item.sales);
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(sales)
    ) {
      throw new Error("The dashboard returned invalid product metrics.");
    }
    return { id: item.id, name: item.name, quantity, sales };
  });

  const recentOrders = value.recent_orders.map((item): RecentOrder => {
    if (!isRecord(item) || !Array.isArray(item.items)) {
      throw new Error("The dashboard returned an invalid order.");
    }
    const total = Number(item.total);
    if (
      typeof item.id !== "string" ||
      typeof item.created_at !== "string" ||
      !Number.isFinite(total)
    ) {
      throw new Error("The dashboard returned invalid order details.");
    }
    const items = item.items.map((orderItem) => {
      if (!isRecord(orderItem)) {
        throw new Error("The dashboard returned an invalid order item.");
      }
      const quantity = Number(orderItem.quantity);
      if (
        typeof orderItem.name !== "string" ||
        (orderItem.variant !== undefined &&
          orderItem.variant !== null &&
          typeof orderItem.variant !== "string") ||
        !Number.isFinite(quantity)
      ) {
        throw new Error("The dashboard returned invalid order item details.");
      }
      return {
        name: orderItem.name,
        variant: typeof orderItem.variant === "string" ? orderItem.variant : null,
        quantity,
      };
    });
    return { id: item.id, total, createdAt: item.created_at, items };
  });

  const refundableOrders = value.refundable_orders.map((item): RefundableOrder => {
    if (!isRecord(item)) throw new Error("The dashboard returned an invalid refundable order.");
    const total = Number(item.total);
    const refunded = Number(item.refunded);
    const remaining = Number(item.remaining);
    if (
      typeof item.id !== "string" ||
      !Number.isFinite(total) ||
      !Number.isFinite(refunded) ||
      !Number.isFinite(remaining)
    ) {
      throw new Error("The dashboard returned invalid refundable order values.");
    }
    return { id: item.id, total, refunded, remaining };
  });

  const lowStock = value.low_stock.map((item): LowStockItem => {
    if (!isRecord(item)) throw new Error("The dashboard returned an invalid stock item.");
    const quantity = Number(item.quantity);
    const threshold = Number(item.threshold);
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.unit !== "string" ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(threshold)
    ) {
      throw new Error("The dashboard returned invalid stock values.");
    }
    return { id: item.id, name: item.name, quantity, threshold, unit: item.unit };
  });

  return {
    orderCount,
    revenue,
    refunds,
    costOfGoodsSold,
    grossProfit,
    expenses,
    netProfit,
    uncostedItems,
    itemsSold,
    salesByDay,
    topProducts,
    recentOrders,
    refundableOrders,
    lowStock,
  };
}

function getWeekRange() {
  const to = new Date();
  to.setUTCHours(24, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 7);
  return { from: from.toISOString(), to: to.toISOString() };
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const transactionDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dayLabel = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  timeZone: "UTC",
});

export default function DashboardClient({
  email,
  role,
}: {
  email: string;
  role: "manager" | "admin";
}) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refundOrderId, setRefundOrderId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [isSavingAction, setIsSavingAction] = useState(false);

  const refreshDashboard = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { from, to } = getWeekRange();
      const { data, error } = await createSupabaseBrowserClient().rpc(
        "manager_dashboard",
        { p_from: from, p_to: to },
      );
      if (error) throw error;
      setMetrics(parseMetrics(data));
      setLastUpdated(new Date());
      setErrorMessage("");
    } catch (error) {
      const message =
        isRecord(error) && typeof error.message === "string"
          ? error.message
          : String(error);
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  async function recordRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(refundAmount);
    if (!refundOrderId || !Number.isFinite(amount) || amount <= 0 || !refundReason.trim()) {
      setErrorMessage("Choose an order and enter a valid refund amount and reason.");
      return;
    }
    setIsSavingAction(true);
    setErrorMessage("");
    setActionMessage("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "record_order_refund",
        {
          p_order_id: refundOrderId,
          p_amount: Number(amount.toFixed(2)),
          p_reason: refundReason.trim(),
        },
      );
      if (error) throw error;
      setRefundAmount("");
      setRefundReason("");
      setActionMessage("Refund recorded.");
      await refreshDashboard();
    } catch (error) {
      setErrorMessage(
        isRecord(error) && typeof error.message === "string"
          ? error.message
          : String(error),
      );
    } finally {
      setIsSavingAction(false);
    }
  }

  async function recordExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(expenseAmount);
    if (!expenseDescription.trim() || !Number.isFinite(amount) || amount <= 0) {
      setErrorMessage("Enter an expense description and amount greater than zero.");
      return;
    }
    setIsSavingAction(true);
    setErrorMessage("");
    setActionMessage("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "record_business_expense",
        {
          p_description: expenseDescription.trim(),
          p_amount: Number(amount.toFixed(2)),
        },
      );
      if (error) throw error;
      setExpenseDescription("");
      setExpenseAmount("");
      setActionMessage("Expense recorded.");
      await refreshDashboard();
    } catch (error) {
      setErrorMessage(
        isRecord(error) && typeof error.message === "string"
          ? error.message
          : String(error),
      );
    } finally {
      setIsSavingAction(false);
    }
  }

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshDashboard();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshDashboard();
    }, 15_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refreshDashboard]);

  const cards = [
    {
      label: "Total revenue · 7 days",
      value: metrics ? currency.format(metrics.revenue) : "—",
      icon: "↗",
    },
    {
      label: "Total orders · 7 days",
      value: metrics ? String(metrics.orderCount) : "—",
      icon: "▤",
    },
    {
      label: "Gross profit · 7 days",
      value: metrics ? currency.format(metrics.grossProfit) : "—",
      icon: "◉",
    },
    {
      label: "Net profit · 7 days",
      value: metrics ? currency.format(metrics.netProfit) : "—",
      icon: "₱",
    },
  ];

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <header className="border-b border-cafe-border bg-cafe-card shadow-[0_2px_12px_rgba(74,52,40,0.04)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cafe-espresso text-xl text-[#fffaf0]">
              ☕
            </div>
            <div>
              <p className="font-semibold tracking-tight text-cafe-espresso">
                KAPE NA NAMAN
              </p>
              <p className="text-xs text-cafe-muted">Business overview</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{email}</p>
              <p className="text-xs capitalize text-cafe-muted">{role}</p>
            </div>
            <span className="rounded-full bg-[#eee5d7] px-3 py-1.5 text-xs font-semibold capitalize text-cafe-espresso sm:hidden">
              {role}
            </span>
            <Link
              href="/"
              className="rounded-lg border border-cafe-border bg-[#f8f4ec] px-3 py-2 text-sm font-medium text-cafe-espresso transition hover:bg-[#f0e8db]"
            >
              Open register
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <ManagementSidebar role={role} />
        <div className="min-w-0 flex-1 px-0 py-2 sm:py-4 lg:px-8 lg:py-8">
        <section className="mb-7 flex flex-wrap items-end justify-between gap-4 rounded-3xl bg-[#eee5d7] px-6 py-7 sm:px-8 sm:py-9">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">
              LIVE BUSINESS OVERVIEW
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-cafe-espresso sm:text-4xl">
              Your week at a glance.
            </h1>
            <p className="mt-2 text-sm text-[#75695d]">
              Sales, inventory, and profit for the last seven days.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <p className="text-xs text-cafe-muted">
                Updated {dateTime.format(lastUpdated)}
              </p>
            )}
            <button
              type="button"
              onClick={() => void refreshDashboard()}
              disabled={isRefreshing}
              className="rounded-lg border border-[#d7cbbb] bg-cafe-card px-3 py-2 text-sm font-medium text-cafe-espresso transition hover:bg-[#f8f4ec] disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800"
          >
            <p className="font-semibold">Could not load business metrics.</p>
            <p className="mt-1">{errorMessage}</p>
            <p className="mt-2">
              Run migrations 20261012210000_dashboard_financials.sql and
              20261012220000_product_recipes_inventory_cost.sql in Supabase, in
              order, then refresh the dashboard.
            </p>
          </div>
        )}

        <section
          aria-label="Key metrics for the last seven days"
          className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {cards.map((card) => (
            <article
              key={card.label}
              className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-cafe-muted">{card.label}</p>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eee5d7] text-cafe-sage-dark">
                  {card.icon}
                </span>
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-tight text-cafe-espresso">
                {isLoading ? "…" : card.value}
              </p>
            </article>
          ))}
        </section>

        {actionMessage && (
          <p role="status" className="mb-5 rounded-xl bg-[#edf1e8] px-4 py-3 text-sm text-cafe-sage-dark">
            {actionMessage}
          </p>
        )}

        {metrics && metrics.uncostedItems > 0 && (
          <p role="status" className="mb-5 rounded-xl border border-[#e7c994] bg-[#fff5df] px-4 py-3 text-sm text-[#76501d]">
            Add supply costs and product recipes in Inventory (or product costs in Products for products without recipes).
            {" "}{metrics.uncostedItems} sold {metrics.uncostedItems === 1 ? "item has" : "items have"} no saved cost; older orders may also lack cost snapshots.
          </p>
        )}

        <div className="mb-7 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
          <section
            aria-labelledby="sales-chart-heading"
            className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
          >
            <div className="mb-5">
              <h2 id="sales-chart-heading" className="text-lg font-semibold text-cafe-espresso">
                Sales · last 7 days
              </h2>
              <p className="mt-1 text-sm text-cafe-muted">Daily revenue and recipe ingredient cost</p>
            </div>
            {isLoading && !metrics ? (
              <p role="status" className="py-8 text-center text-sm text-cafe-muted">Loading sales...</p>
            ) : metrics?.salesByDay.length ? (
              <div className="grid h-56 grid-cols-7 items-end gap-2 sm:gap-4">
                {(() => {
                  const highest = Math.max(...metrics.salesByDay.flatMap((day) => [day.sales, day.cost]), 1);
                  return metrics.salesByDay.map((day) => (
                    <div key={day.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
                      <div className="flex h-[65%] w-full max-w-16 items-end justify-center gap-1" title={`${day.orders} orders · Revenue ${currency.format(day.sales)} · Ingredient cost ${currency.format(day.cost)}`}>
                        <div
                          className="w-1/2 rounded-t-md bg-cafe-sage-dark"
                          style={{ height: `${Math.max(day.sales > 0 ? 3 : 0, (day.sales / highest) * 100)}%` }}
                          aria-label={`${dayLabel.format(new Date(`${day.date}T00:00:00Z`))} revenue ${currency.format(day.sales)}`}
                        />
                        <div
                          className="w-1/2 rounded-t-md bg-[#c99556]"
                          style={{ height: `${Math.max(day.cost > 0 ? 3 : 0, (day.cost / highest) * 100)}%` }}
                          aria-label={`${dayLabel.format(new Date(`${day.date}T00:00:00Z`))} ingredient cost ${currency.format(day.cost)}`}
                        />
                      </div>
                      <span className="text-xs font-medium text-cafe-muted">
                        {dayLabel.format(new Date(`${day.date}T00:00:00Z`))}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-cafe-muted">No sales in this period.</p>
            )}
            <div className="mt-4 flex justify-center gap-5 text-xs text-cafe-muted">
              <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-cafe-sage-dark" />Revenue</span>
              <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#c99556]" />Ingredient cost</span>
            </div>
          </section>

          <section
            aria-labelledby="profit-heading"
            className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
          >
            <h2 id="profit-heading" className="mb-5 text-lg font-semibold text-cafe-espresso">
              Net profit breakdown
            </h2>
            {isLoading && !metrics ? (
              <p role="status" className="py-8 text-center text-sm text-cafe-muted">Loading profit...</p>
            ) : metrics ? (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-3"><dt>Revenue</dt><dd className="font-medium">{currency.format(metrics.revenue)}</dd></div>
                <div className="flex justify-between gap-3 text-[#9a5143]"><dt>Refunds</dt><dd>−{currency.format(metrics.refunds)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-cafe-border pt-3"><dt>Cost of goods sold</dt><dd>−{currency.format(metrics.costOfGoodsSold)}</dd></div>
                <div className="flex justify-between gap-3 font-semibold"><dt>Gross profit</dt><dd>{currency.format(metrics.grossProfit)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-cafe-border pt-3 text-[#9a5143]"><dt>Expenses</dt><dd>−{currency.format(metrics.expenses)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-cafe-border pt-3 text-base font-semibold text-cafe-espresso"><dt>Net profit</dt><dd>{currency.format(metrics.netProfit)}</dd></div>
              </dl>
            ) : (
              <p className="py-8 text-center text-sm text-cafe-muted">Profit data is unavailable.</p>
            )}
            <p className="mt-4 text-xs text-cafe-muted">
              Revenue includes order totals and tax. Item costs are captured when each order is placed.
            </p>
          </section>
        </div>

        <div className="mb-7 grid gap-6 lg:grid-cols-2">
          <section
            aria-labelledby="inventory-alerts-heading"
            className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id="inventory-alerts-heading" className="text-lg font-semibold text-cafe-espresso">Low / out-of-stock inventory</h2>
                <p className="mt-1 text-sm text-cafe-muted">Items at or below their alert threshold</p>
              </div>
              <Link href="/inventory" className="shrink-0 text-sm font-medium text-cafe-sage-dark hover:underline">Manage stock</Link>
            </div>
            {isLoading && !metrics ? (
              <p role="status" className="py-6 text-center text-sm text-cafe-muted">Loading inventory...</p>
            ) : metrics?.lowStock.length ? (
              <ul className="divide-y divide-cafe-border">
                {metrics.lowStock.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${item.quantity <= 0 ? "bg-red-100 text-red-800" : "bg-[#fff0d1] text-[#76501d]"}`}>
                      {item.quantity <= 0 ? "Out of stock" : "Low stock"} · {item.quantity} {item.unit}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-cafe-muted">No low-stock items.</p>
            )}
          </section>

          <section
            aria-labelledby="financial-entry-heading"
            className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
          >
            <h2 id="financial-entry-heading" className="mb-4 text-lg font-semibold text-cafe-espresso">Record refund or expense</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              <form className="space-y-3" onSubmit={(event) => void recordRefund(event)}>
                <h3 className="text-sm font-semibold">Refund</h3>
                <label className="sr-only" htmlFor="refund-order">Order to refund</label>
                <select id="refund-order" required value={refundOrderId} onChange={(event) => setRefundOrderId(event.target.value)} className="h-10 w-full rounded-lg border border-cafe-border bg-white px-3 text-sm">
                  <option value="">Choose an order</option>
                  {metrics?.refundableOrders.map((order) => (
                    <option key={order.id} value={order.id}>#{order.id.slice(0, 8)} · {currency.format(order.remaining)} remaining</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="refund-amount">Refund amount in PHP</label>
                <input id="refund-amount" required type="number" min="0.01" step="0.01" max={metrics?.refundableOrders.find((order) => order.id === refundOrderId)?.remaining} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="Refund amount (PHP)" className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm" />
                <label className="sr-only" htmlFor="refund-reason">Refund reason</label>
                <input id="refund-reason" required maxLength={200} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="Reason" className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm" />
                <button type="submit" disabled={isSavingAction || !metrics?.refundableOrders.length} className="h-10 rounded-lg bg-cafe-sage-dark px-4 text-sm font-medium text-white disabled:opacity-50">{isSavingAction ? "Saving..." : "Record refund"}</button>
              </form>
              <form className="space-y-3" onSubmit={(event) => void recordExpense(event)}>
                <h3 className="text-sm font-semibold">Expense</h3>
                <p className="text-xs text-cafe-muted">Record operating expenses here, not ingredient costs already included in item costs.</p>
                <label className="sr-only" htmlFor="expense-description">Expense description</label>
                <input id="expense-description" required maxLength={120} value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} placeholder="e.g. Milk delivery" className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm" />
                <label className="sr-only" htmlFor="expense-amount">Expense amount in PHP</label>
                <input id="expense-amount" required type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} placeholder="Amount (PHP)" className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm" />
                <button type="submit" disabled={isSavingAction} className="h-10 rounded-lg bg-cafe-sage-dark px-4 text-sm font-medium text-white disabled:opacity-50">{isSavingAction ? "Saving..." : "Record expense"}</button>
              </form>
            </div>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section
            aria-labelledby="best-sellers-heading"
            className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
          >
            <div className="mb-5">
              <h2 id="best-sellers-heading" className="text-lg font-semibold text-cafe-espresso">
                Best sellers · 7 days
              </h2>
              <p className="mt-1 text-sm text-cafe-muted">
                Ranked by quantity sold this week
              </p>
            </div>
            {isLoading && !metrics ? (
              <p role="status" className="py-8 text-center text-sm text-cafe-muted">
                Loading products...
              </p>
            ) : metrics?.topProducts.length ? (
              <ol className="divide-y divide-cafe-border">
                {metrics.topProducts.map((product, index) => (
                  <li
                    key={product.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eee5d7] text-sm font-semibold text-cafe-sage-dark">
                        {index + 1}
                      </span>
                      <span className="truncate text-sm font-medium">
                        {product.name}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold">{product.quantity} sold</p>
                      <p className="text-xs text-cafe-muted">
                        {currency.format(product.sales)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-8 text-center text-sm text-cafe-muted">
                No sales in this period.
              </p>
            )}
          </section>

          <section
            aria-labelledby="recent-orders-heading"
            className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
          >
            <div className="mb-5">
              <h2 id="recent-orders-heading" className="text-lg font-semibold text-cafe-espresso">
                Recent transactions
              </h2>
              <p className="mt-1 text-sm text-cafe-muted">
                The latest orders across all dates
              </p>
            </div>
            {isLoading && !metrics ? (
              <p role="status" className="py-8 text-center text-sm text-cafe-muted">
                Loading orders...
              </p>
            ) : metrics?.recentOrders.length ? (
              <ul className="divide-y divide-cafe-border">
                {metrics.recentOrders.map((order) => (
                  <li
                    key={order.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Order #{order.id.slice(0, 8)}
                      </p>
                      <p className="mt-1 truncate text-xs text-cafe-muted">
                        {order.items
                          .map(
                            (item) =>
                              `${item.quantity}× ${item.name}${item.variant ? ` (${item.variant})` : ""}`,
                          )
                          .join(", ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold">
                        {currency.format(order.total)}
                      </p>
                      <p className="text-xs text-cafe-muted">
                        {transactionDate.format(new Date(order.createdAt))}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-cafe-muted">
                No transactions yet.
              </p>
            )}
          </section>
        </div>
        <p className="mt-5 text-right text-xs text-cafe-muted">
          Updates automatically every 15 seconds · All amounts in Philippine pesos (PHP)
        </p>
        </div>
      </div>
    </main>
  );
}
