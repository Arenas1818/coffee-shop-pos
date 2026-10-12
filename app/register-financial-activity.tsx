"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";
import { currency } from "@/lib/currency";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type RefundableOrder = {
  id: string;
  remaining: number;
};

type RecentOrder = {
  id: string;
  total: number;
  createdAt: string;
  items: { name: string; variant: string | null; quantity: number }[];
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
    const total = Number(item.total);
    if (
      typeof item.id !== "string" ||
      typeof item.created_at !== "string" ||
      !Number.isFinite(total)
    ) {
      throw new Error("The register returned invalid transaction details.");
    }
    const items = item.items.map((orderItem) => {
      if (!isRecord(orderItem)) {
        throw new Error("The register returned an invalid transaction item.");
      }
      const quantity = Number(orderItem.quantity);
      if (
        typeof orderItem.name !== "string" ||
        (orderItem.variant !== undefined &&
          orderItem.variant !== null &&
          typeof orderItem.variant !== "string") ||
        !Number.isFinite(quantity)
      ) {
        throw new Error("The register returned invalid transaction item details.");
      }
      return {
        name: orderItem.name,
        variant:
          typeof orderItem.variant === "string" ? orderItem.variant : null,
        quantity,
      };
    });
    return { id: item.id, total, createdAt: item.created_at, items };
  });

  return { refundableOrders, recentOrders };
}

const transactionDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function RegisterFinancialActivity({
  role,
}: {
  role: "staff" | "manager" | "admin";
}) {
  const [activity, setActivity] = useState<RegisterActivity | null>(null);
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
        <div className="mb-5 flex items-center justify-between gap-3">
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
                      {currency.format(order.remaining)} remaining
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
