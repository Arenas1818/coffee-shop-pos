"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useStoreSettings } from "@/lib/store-settings";

type RefundableOrder = {
  id: string;
  remaining: number;
};

type RecentOrder = {
  id: string;
  subtotal: number;
  discountType: "pwd" | "senior" | "pwd_senior" | null;
  discountAmount: number;
  tax: number;
  total: number;
  paymentMethod: string | null;
  amountReceived: number | null;
  createdAt: string;
  items: {
    name: string;
    variant: string | null;
    quantity: number;
    unitPrice: number | null;
  }[];
};

type RegisterActivity = {
  refundableOrders: RefundableOrder[];
  recentOrders: RecentOrder[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
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

function parseActivity(value: unknown): RegisterActivity {
  if (
    !isRecord(value) ||
    !Array.isArray(value.refundable_orders) ||
    !Array.isArray(value.recent_orders)
  ) {
    throw new Error("The register returned invalid transaction data.");
  }

  const refundableOrders = value.refundable_orders.map((item) => {
    if (!isRecord(item)) {
      throw new Error("The register returned an invalid refundable order.");
    }
    const remaining = Number(item.remaining);
    if (typeof item.id !== "string" || !Number.isFinite(remaining)) {
      throw new Error("The register returned invalid refund details.");
    }
    return { id: item.id, remaining };
  });

  const recentOrders = value.recent_orders.map((item): RecentOrder => {
    if (!isRecord(item) || !Array.isArray(item.items)) {
      throw new Error("The register returned an invalid recent transaction.");
    }
    const subtotal = Number(item.subtotal);
    const discountAmount = Number(item.discount_amount);
    const tax = Number(item.tax);
    const total = Number(item.total);
    const amountReceived =
      item.amount_received === null ? null : Number(item.amount_received);
    if (
      typeof item.id !== "string" ||
      typeof item.created_at !== "string" ||
      !Number.isFinite(subtotal) ||
      !Number.isFinite(discountAmount) ||
      !Number.isFinite(tax) ||
      !Number.isFinite(total) ||
      (item.discount_type !== null &&
        item.discount_type !== "pwd" &&
      item.discount_type !== "senior" &&
      item.discount_type !== "pwd_senior") ||
      (item.payment_method !== null &&
        typeof item.payment_method !== "string") ||
      (amountReceived !== null && !Number.isFinite(amountReceived))
    ) {
      throw new Error("The register returned invalid transaction details.");
    }
    const items = item.items.map((orderItem) => {
      if (!isRecord(orderItem)) {
        throw new Error("The register returned an invalid transaction item.");
      }
      const quantity = Number(orderItem.quantity);
      const unitPrice =
        orderItem.unit_price === null || orderItem.unit_price === undefined
          ? null
          : Number(orderItem.unit_price);
      if (
        typeof orderItem.name !== "string" ||
        (orderItem.variant !== undefined &&
          orderItem.variant !== null &&
          typeof orderItem.variant !== "string") ||
        !Number.isFinite(quantity) ||
        (unitPrice !== null && !Number.isFinite(unitPrice))
      ) {
        throw new Error("The register returned invalid transaction item details.");
      }
      return {
        name: orderItem.name,
        variant:
          typeof orderItem.variant === "string" ? orderItem.variant : null,
        quantity,
        unitPrice,
      };
    });
    return {
      id: item.id,
      subtotal,
      discountType:
        item.discount_type === "pwd" ||
        item.discount_type === "senior" ||
        item.discount_type === "pwd_senior"
          ? item.discount_type
          : null,
      discountAmount,
      tax,
      total,
      paymentMethod:
        typeof item.payment_method === "string" ? item.payment_method : null,
      amountReceived,
      createdAt: item.created_at,
      items,
    };
  });

  return { refundableOrders, recentOrders };
}

const transactionDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const transactionDiscountLabels = {
  pwd: "PWD · 10% discount",
  senior: "Senior Citizen · 10% discount",
  pwd_senior: "PWD / Senior Citizen · 10% discount",
} as const;

export default function RegisterFinancialActivity({
  role,
}: {
  role: "staff" | "manager" | "admin";
}) {
  const { formatCurrency, settings } = useStoreSettings();
  const [activity, setActivity] = useState<RegisterActivity | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<RecentOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [refundOrderId, setRefundOrderId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");

  function closeRefundDialog() {
    if (isSaving) return;
    setIsRefundDialogOpen(false);
    setManagerEmail("");
    setManagerPassword("");
    setErrorMessage("");
  }

  async function refreshActivity() {
    setIsLoading(true);
    try {
      const { data, error } = await createSupabaseBrowserClient().rpc(
        "register_activity",
      );
      if (error) throw error;
      setActivity(parseActivity(data));
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshActivity();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, []);

  async function recordRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(refundAmount);
    if (
      !refundOrderId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !refundReason.trim() ||
      !managerEmail.trim() ||
      !managerPassword
    ) {
      setErrorMessage(
        "Complete the refund details and enter a manager or admin sign-in.",
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setActionMessage("");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !publishableKey) {
      setErrorMessage("Supabase is not configured for refund approval.");
      setIsSaving(false);
      return;
    }

    const approver = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    try {
      const { error: signInError } = await approver.auth.signInWithPassword({
        email: managerEmail.trim(),
        password: managerPassword,
      });
      if (signInError) throw signInError;

      const { error } = await approver.rpc(
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
      setManagerEmail("");
      setManagerPassword("");
      setIsRefundDialogOpen(false);
      setActionMessage("Refund recorded.");
      await refreshActivity();
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      const { error: clearSessionError } = await approver.auth.signOut({
        scope: "local",
      });
      if (clearSessionError) {
        setErrorMessage(
          `Could not clear the temporary approval session: ${describeError(clearSessionError)}`,
        );
      }
      setManagerPassword("");
      setIsSaving(false);
    }
  }

  async function recordExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(expenseAmount);
    if (
      !expenseDescription.trim() ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setErrorMessage("Enter an expense description and amount greater than zero.");
      return;
    }

    setIsSaving(true);
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
      await refreshActivity();
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-label="Register financial activity"
      className="mx-auto grid max-w-[1440px] gap-6 px-5 pb-8 sm:px-8"
    >
      {role !== "staff" && (
        <section
          aria-labelledby="register-financial-entry-heading"
          className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
        >
          <h2
            id="register-financial-entry-heading"
            className="mb-4 text-lg font-semibold text-cafe-espresso"
          >
            Record expense
          </h2>
          <form className="space-y-3" onSubmit={(event) => void recordExpense(event)}>
            <h3 className="text-sm font-semibold">Expense</h3>
            <p className="text-xs text-cafe-muted">
              Record operating expenses here, not ingredient costs already
              included in item costs.
            </p>
            <label className="sr-only" htmlFor="register-expense-description">
              Expense description
            </label>
            <input
              id="register-expense-description"
              required
              maxLength={120}
              value={expenseDescription}
              onChange={(event) => setExpenseDescription(event.target.value)}
              placeholder="e.g. Milk delivery"
              className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm"
            />
            <label className="sr-only" htmlFor="register-expense-amount">
              Expense amount in PHP
            </label>
            <input
              id="register-expense-amount"
              required
              type="number"
              min="0.01"
              step="0.01"
              value={expenseAmount}
              onChange={(event) => setExpenseAmount(event.target.value)}
              placeholder="Amount (PHP)"
              className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm"
            />
            <button
              type="submit"
              disabled={isSaving}
              className="h-10 rounded-lg bg-cafe-sage-dark px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Record expense"}
            </button>
          </form>
        </section>
      )}

      <section
        aria-labelledby="register-recent-transactions-heading"
        className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6"
      >
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="register-recent-transactions-heading"
              className="text-lg font-semibold text-cafe-espresso"
            >
              Recent transactions
            </h2>
            <p className="mt-1 text-sm text-cafe-muted">
              The latest orders across all dates
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setErrorMessage("");
                setIsRefundDialogOpen(true);
              }}
              disabled={isLoading || !activity?.refundableOrders.length}
              title={
                activity?.refundableOrders.length
                  ? "Record a refund with manager or admin approval"
                  : "No refundable orders are available"
              }
              className="rounded-lg bg-cafe-sage-dark px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Record refund
            </button>
            <button
              type="button"
              onClick={() => void refreshActivity()}
              disabled={isLoading}
              className="rounded-lg border border-cafe-border bg-[#f8f4ec] px-3 py-2 text-sm font-medium text-cafe-espresso disabled:opacity-60"
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
        {isLoading && !activity ? (
          <p role="status" className="py-8 text-center text-sm text-cafe-muted">
            Loading transactions...
          </p>
        ) : activity?.recentOrders.length ? (
          <ul className="divide-y divide-cafe-border">
            {activity.recentOrders.map((order) => (
              <li key={order.id} className="py-3">
                <button
                  type="button"
                  onClick={() => setSelectedOrder(order)}
                  className="flex w-full items-center justify-between gap-4 rounded-lg text-left transition hover:bg-[#f8f4ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cafe-sage-dark"
                  aria-label={`View receipt for order ${order.id.slice(0, 8)}`}
                >
                  <div className="min-w-0 py-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">
                        Order #{order.id.slice(0, 8)}
                      </p>
                      <span className="rounded-full bg-[#f3eee5] px-2.5 py-1 text-xs font-medium capitalize text-cafe-espresso">
                        {order.paymentMethod?.replace("_", " ") ?? "Payment unrecorded"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-cafe-muted">
                      {order.items
                        .map(
                          (item) =>
                            `${item.quantity}× ${item.name}${item.variant ? ` (${item.variant})` : ""}`,
                        )
                        .join(", ")}
                    </p>
                    {order.discountType && (
                      <span className="mt-2 inline-flex rounded-full bg-[#edf1e8] px-2.5 py-1 text-xs font-semibold text-cafe-sage-dark">
                        {transactionDiscountLabels[order.discountType]}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">
                      {formatCurrency(order.total)}
                    </p>
                    <p className="text-xs text-cafe-muted">
                      {transactionDate.format(new Date(order.createdAt))}
                    </p>
                    <p className="mt-1 text-xs font-medium text-cafe-sage-dark">
                      View receipt
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-sm text-cafe-muted">
            No transactions yet.
          </p>
        )}
      </section>
      {actionMessage && (
        <p
          role="status"
          className="rounded-xl bg-[#edf1e8] px-4 py-3 text-sm text-cafe-sage-dark"
        >
          {actionMessage}
        </p>
      )}
      {errorMessage && !isRefundDialogOpen && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          Could not load or save register activity: {errorMessage}
        </p>
      )}
      {selectedOrder && (
        <div className="receipt-overlay fixed inset-0 z-[65] flex items-center justify-center overflow-y-auto bg-[#241b15]/60 px-4 py-8">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-receipt-title"
            className="receipt-print w-full max-w-md rounded-2xl bg-white p-6 text-[#28251f] shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3 print:hidden">
              <div>
                <h2
                  id="transaction-receipt-title"
                  className="text-xl font-semibold"
                >
                  Transaction receipt
                </h2>
                <p className="mt-1 text-sm text-cafe-muted">
                  Order #{selectedOrder.id.slice(0, 8)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close transaction receipt"
                onClick={() => setSelectedOrder(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-cafe-border text-lg"
              >
                ×
              </button>
            </div>
            <div className="receipt-content">
              <header className="border-b border-dashed border-[#bdb6aa] pb-4 text-center">
                <h3 className="text-lg font-bold tracking-wide">
                  {settings.storeName}
                </h3>
                <p className="mt-1 text-sm">Point of sale receipt</p>
                {settings.address && <p className="mt-1 text-xs">{settings.address}</p>}
                {settings.phone && <p className="mt-1 text-xs">{settings.phone}</p>}
                <p className="mt-2 break-all text-xs">
                  Order: {selectedOrder.id}
                </p>
                <p className="mt-1 text-xs">
                  {transactionDate.format(new Date(selectedOrder.createdAt))}
                </p>
              </header>
              <ul className="space-y-3 border-b border-dashed border-[#bdb6aa] py-4 text-sm">
                {selectedOrder.items.map((item, index) => (
                  <li
                    key={`${item.name}-${item.variant}-${index}`}
                    className="flex justify-between gap-4"
                  >
                    <span>
                      {item.quantity} × {item.name}
                      {item.variant ? ` (${item.variant})` : ""}
                    </span>
                    <span className="whitespace-nowrap">
                      {item.unitPrice === null
                        ? "—"
                        : formatCurrency(item.unitPrice * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-2 py-4 text-sm">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd>{formatCurrency(selectedOrder.subtotal)}</dd>
                </div>
                {selectedOrder.discountType && (
                  <div className="flex justify-between">
                    <dt>
                      {transactionDiscountLabels[selectedOrder.discountType]}
                    </dt>
                    <dd>−{formatCurrency(selectedOrder.discountAmount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>Tax</dt>
                  <dd>{formatCurrency(selectedOrder.tax)}</dd>
                </div>
                <div className="flex justify-between border-t border-[#bdb6aa] pt-3 text-base font-bold">
                  <dt>Total</dt>
                  <dd>{formatCurrency(selectedOrder.total)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Payment method</dt>
                  <dd>{selectedOrder.paymentMethod ?? "Not recorded"}</dd>
                </div>
                {selectedOrder.amountReceived !== null && (
                  <div className="flex justify-between">
                    <dt>Amount received</dt>
                    <dd>{formatCurrency(selectedOrder.amountReceived)}</dd>
                  </div>
                )}
                {selectedOrder.paymentMethod === "cash" &&
                  selectedOrder.amountReceived !== null && (
                    <div className="flex justify-between">
                      <dt>Change</dt>
                      <dd>
                        {formatCurrency(
                          selectedOrder.amountReceived - selectedOrder.total,
                        )}
                      </dd>
                    </div>
                  )}
              </dl>
              <p className="border-t border-dashed border-[#bdb6aa] pt-4 text-center text-xs">
                {settings.receiptFooter}
              </p>
            </div>
            <div className="mt-6 flex gap-3 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="h-11 flex-1 rounded-xl bg-cafe-sage-dark px-4 font-medium text-white"
              >
                Print receipt
              </button>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="h-11 rounded-xl border border-cafe-border px-4 font-medium"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
      {isRefundDialogOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#241b15]/60 px-4 py-8">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-approval-title"
            className="w-full max-w-lg rounded-2xl border border-cafe-border bg-cafe-card p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2
                  id="refund-approval-title"
                  className="text-xl font-semibold text-cafe-espresso"
                >
                  Manager approval required
                </h2>
                <p className="mt-2 text-sm text-cafe-muted">
                  Enter a Manager or Admin Supabase sign-in to authorize this
                  refund. The cashier will stay signed in.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close refund approval"
                disabled={isSaving}
                onClick={closeRefundDialog}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-cafe-border text-lg disabled:opacity-50"
              >
                ×
              </button>
            </div>
            <form className="space-y-4" onSubmit={(event) => void recordRefund(event)}>
              <div>
                <label
                  htmlFor="register-refund-order"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Order to refund
                </label>
                <select
                  id="register-refund-order"
                  required
                  value={refundOrderId}
                  onChange={(event) => setRefundOrderId(event.target.value)}
                  className="h-11 w-full rounded-lg border border-cafe-border bg-white px-3 text-sm"
                >
                  <option value="">Choose an order</option>
                  {activity?.refundableOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      #{order.id.slice(0, 8)} ·{" "}
                      {formatCurrency(order.remaining)} remaining
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="register-refund-amount"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Refund amount (PHP)
                </label>
                <input
                  id="register-refund-amount"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={activity?.refundableOrders.find(
                    (order) => order.id === refundOrderId,
                  )?.remaining}
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="register-refund-reason"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Reason
                </label>
                <input
                  id="register-refund-reason"
                  required
                  maxLength={200}
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="manager-approval-email"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Manager/Admin email
                </label>
                <input
                  id="manager-approval-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={managerEmail}
                  onChange={(event) => setManagerEmail(event.target.value)}
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="manager-approval-password"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Manager/Admin password
                </label>
                <input
                  id="manager-approval-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={managerPassword}
                  onChange={(event) => setManagerPassword(event.target.value)}
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
              </div>
              {errorMessage && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {errorMessage}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={closeRefundDialog}
                  className="h-11 rounded-xl border border-cafe-border px-4 font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-11 rounded-xl bg-cafe-sage-dark px-4 font-medium text-white disabled:opacity-50"
                >
                  {isSaving ? "Verifying and recording..." : "Approve refund"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
