"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import ManagementSidebar from "../management-sidebar";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useStoreSettings } from "@/lib/store-settings";

type InventoryItem = {
  id: string;
  name: string;
  item_type: "supply" | "product";
  product_id: string | null;
  unit: string;
  unit_cost: number | null;
  quantity: number;
  low_stock_threshold: number;
  active: boolean;
};
type Movement = {
  id: string;
  movement_type: "restock" | "sale" | "adjustment";
  quantity_change: number;
  note: string | null;
  created_at: string;
  staff_email: string | null;
  unit: string | null;
};

const initialForm = {
  name: "",
  unit: "unit",
  unit_cost: "",
  low_stock_threshold: "0",
};

type SupplyEdit = {
  name: string;
  unit: string;
  quantity: string;
  lowStockThreshold: string;
};

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

function amount(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(
    value,
  );
}

const movementDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function InventoryClient({
  role,
}: {
  role: "manager" | "admin";
}) {
  const { settings, formatCurrency } = useStoreSettings();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [form, setForm] = useState(initialForm);
  const [restockAmounts, setRestockAmounts] = useState<Record<string, string>>(
    {},
  );
  const [restockCosts, setRestockCosts] = useState<Record<string, string>>({});
  const [restockNotes, setRestockNotes] = useState<Record<string, string>>({});
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [costEditValue, setCostEditValue] = useState("");
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null);
  const [supplyEdit, setSupplyEdit] = useState<SupplyEdit>({
    name: "",
    unit: "",
    quantity: "",
    lowStockThreshold: "",
  });
  const [activity, setActivity] = useState<Record<string, Movement[]>>({});
  const [activityOpen, setActivityOpen] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const inventoryResult = await supabase
      .from("inventory_items")
      .select("id, name, item_type, product_id, unit, unit_cost, quantity, low_stock_threshold, active")
      .order("name");
    if (inventoryResult.error) throw inventoryResult.error;
    setItems((inventoryResult.data ?? []) as InventoryItem[]);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        await loadData();
      } catch (error) {
        if (active) setErrorMessage(`Could not load inventory: ${errorText(error)}`);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [loadData]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadData().catch((error: unknown) => {
        setErrorMessage(`Could not refresh inventory: ${errorText(error)}`);
      });
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const threshold = Number(form.low_stock_threshold);
    if (
      !form.unit.trim() ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      !form.name.trim()
    ) {
      setErrorMessage("Enter a valid item name, unit, and low-stock threshold.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const unitCost = form.unit_cost.trim() ? Number(form.unit_cost) : null;
      if (
        unitCost !== null &&
        (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 99999999.9999)
      ) {
        throw new Error("Unit cost must be blank or a non-negative amount.");
      }
      const { error } = await createSupabaseBrowserClient()
        .from("inventory_items")
        .insert({
          name: form.name.trim(),
          item_type: "supply",
          product_id: null,
          unit: form.unit.trim(),
          unit_cost: unitCost === null ? null : Number(unitCost.toFixed(4)),
          low_stock_threshold: Number(threshold.toFixed(3)),
        });
      if (error) throw error;
      await loadData();
      setForm(initialForm);
      setNotice("Supply added. Use Restock to record its starting quantity.");
    } catch (error) {
      setErrorMessage(`Could not add inventory item: ${errorText(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function restock(item: InventoryItem) {
    const quantity = Number(restockAmounts[item.id]);
    const unitCost = restockCosts[item.id]?.trim()
      ? Number(restockCosts[item.id])
      : null;
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      (unitCost !== null &&
        (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 99999999.9999))
    ) {
      setErrorMessage("Enter a valid restock amount and optional non-negative unit cost.");
      return;
    }
    setBusyId(item.id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "restock_inventory",
        {
          p_inventory_item_id: item.id,
          p_quantity: Number(quantity.toFixed(3)),
          p_note: restockNotes[item.id] || null,
          p_unit_cost: unitCost === null ? null : Number(unitCost.toFixed(4)),
        },
      );
      if (error) throw error;
      await loadData();
      setRestockAmounts((current) => ({ ...current, [item.id]: "" }));
      setRestockCosts((current) => ({ ...current, [item.id]: "" }));
      setRestockNotes((current) => ({ ...current, [item.id]: "" }));
      setNotice(`${item.name} restocked.`);
    } catch (error) {
      setErrorMessage(`Could not restock ${item.name}: ${errorText(error)}`);
    } finally {
      setBusyId("");
    }
  }

  async function updateSupplyCost(item: InventoryItem) {
    const trimmedCost = costEditValue.trim();
    const unitCost = trimmedCost ? Number(trimmedCost) : null;
    if (
      unitCost !== null &&
      (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 99999999.9999)
    ) {
      setErrorMessage("Enter a valid non-negative supply cost per unit.");
      return;
    }

    setBusyId(item.id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient()
        .from("inventory_items")
        .update({
          unit_cost:
            unitCost === null ? null : Number(unitCost.toFixed(4)),
        })
        .eq("id", item.id)
        .eq("item_type", "supply")
        .select("id")
        .single();
      if (error) throw error;
      await loadData();
      setEditingCostId(null);
      setCostEditValue("");
      setNotice(
        `${item.name} cost updated. This applies to future ingredient cost calculations.`,
      );
    } catch (error) {
      setErrorMessage(`Could not update ${item.name} cost: ${errorText(error)}`);
    } finally {
      setBusyId("");
    }
  }

  async function updateSupply(item: InventoryItem) {
    const name = supplyEdit.name.trim();
    const unit = supplyEdit.unit.trim();
    const quantity = Number(supplyEdit.quantity);
    const threshold = Number(supplyEdit.lowStockThreshold);
    if (
      name.length < 1 ||
      name.length > 100 ||
      unit.length < 1 ||
      unit.length > 24 ||
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      quantity > 999999999.999 ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 999999999.999
    ) {
      setErrorMessage(
        "Enter a valid supply name, unit, quantity, and non-negative alert threshold.",
      );
      return;
    }

    setBusyId(item.id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "update_supply_details",
        {
          p_inventory_item_id: item.id,
          p_name: name,
          p_unit: unit,
          p_quantity: Number(quantity.toFixed(3)),
          p_low_stock_threshold: Number(threshold.toFixed(3)),
          p_note: `Manual adjustment: ${amount(item.quantity)} ${item.unit} to ${amount(quantity)} ${unit}`,
        },
      );
      if (error) throw error;
      await loadData();
      setEditingSupplyId(null);
      setSupplyEdit({
        name: "",
        unit: "",
        quantity: "",
        lowStockThreshold: "",
      });
      setNotice(`${name} updated.`);
    } catch (error) {
      setErrorMessage(`Could not update ${item.name}: ${errorText(error)}`);
    } finally {
      setBusyId("");
    }
  }

  async function toggleActive(item: InventoryItem) {
    setBusyId(item.id);
    setErrorMessage("");
    try {
      const { error } = await createSupabaseBrowserClient()
        .from("inventory_items")
        .update({ active: !item.active, updated_at: new Date().toISOString() })
        .eq("id", item.id);
      if (error) throw error;
      await loadData();
      setNotice(item.active ? "Inventory item archived." : "Inventory item restored.");
    } catch (error) {
      setErrorMessage(`Could not update inventory item: ${errorText(error)}`);
    } finally {
      setBusyId("");
    }
  }

  async function toggleActivity(item: InventoryItem) {
    if (activityOpen === item.id) {
      setActivityOpen(null);
      return;
    }
    setActivityOpen(item.id);
    setErrorMessage("");
    try {
      const { data, error } = await createSupabaseBrowserClient().rpc(
        "inventory_activity",
        { p_inventory_item_id: item.id },
      );
      if (error) throw error;
      setActivity((current) => ({ ...current, [item.id]: (data ?? []) as Movement[] }));
    } catch (error) {
      setErrorMessage(`Could not load stock history: ${errorText(error)}`);
    }
  }

  const supplyItems = items.filter((item) => item.item_type === "supply");
  const activeSupplies = supplyItems.filter((item) => item.active);
  function effectiveThreshold(item: InventoryItem) {
    return item.low_stock_threshold || settings.globalLowStockThreshold;
  }
  const lowStockItems = activeSupplies.filter(
    (item) => item.quantity <= effectiveThreshold(item),
  );
  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:min-h-screen lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <ManagementSidebar role={role} />
        <div className="min-w-0 flex-1 px-0 py-2 lg:px-8 lg:py-8">
          <header className="mb-7">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">
              KAPE NA NAMAN
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-cafe-espresso">
              Inventory
            </h1>
            <p className="mt-2 text-sm text-cafe-muted">
              Add supplies and manage stock levels, costs, and activity.
            </p>
          </header>

          {errorMessage && (
            <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {errorMessage}
            </p>
          )}
          {notice && (
            <p role="status" className="mb-5 rounded-xl bg-[#edf1e8] px-4 py-3 text-sm text-cafe-sage-dark">
              {notice}
            </p>
          )}

          {lowStockItems.length > 0 && (
            <section
              role="status"
              aria-label="Low-stock alert"
              className="mb-6 rounded-2xl border border-[#e7c994] bg-[#fff5df] p-5"
            >
              <h2 className="font-semibold text-[#76501d]">
                Low stock alert · {lowStockItems.length} {lowStockItems.length === 1 ? "item" : "items"}
              </h2>
              <p className="mt-1 text-sm text-[#765f3e]">
                {lowStockItems
                  .map((item) => `${item.name} (${amount(item.quantity)} ${item.unit})`)
                  .join(" · ")}
              </p>
            </section>
          )}

          <section className="mb-7 rounded-2xl border border-cafe-border bg-cafe-card p-5 sm:p-7">
            <h2 className="text-lg font-semibold text-cafe-espresso">
              Add supply
            </h2>
            <form className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" onSubmit={addItem}>
              <div>
                <label htmlFor="inventory-name" className="mb-1.5 block text-sm font-medium">Supply name</label>
                <input
                  id="inventory-name"
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="e.g. Whole milk"
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="inventory-unit" className="mb-1.5 block text-sm font-medium">Unit</label>
                <input
                  id="inventory-unit"
                  required
                  maxLength={24}
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  placeholder="e.g. bottle, kg, each"
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="inventory-cost" className="mb-1.5 block text-sm font-medium">Cost per unit (PHP, optional)</label>
                <input
                  id="inventory-cost"
                  type="number"
                  min="0"
                  max="99999999"
                  step="0.0001"
                  value={form.unit_cost}
                  onChange={(event) => setForm({ ...form, unit_cost: event.target.value })}
                  placeholder="e.g. cost per ml or gram"
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="inventory-threshold" className="mb-1.5 block text-sm font-medium">Low-stock alert at</label>
                <input
                  id="inventory-threshold"
                  type="number"
                  min="0"
                  step="0.001"
                  required
                  value={form.low_stock_threshold}
                  onChange={(event) => setForm({ ...form, low_stock_threshold: event.target.value })}
                  className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm"
                />
                <p className="mt-1 text-xs text-cafe-muted">
                  Enter 0 to use the global threshold ({amount(settings.globalLowStockThreshold)}).
                </p>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-11 rounded-xl border border-black bg-black px-5 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-wait disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Add supply"}
                </button>
              </div>
            </form>
          </section>

          <section aria-labelledby="stock-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="stock-heading" className="text-lg font-semibold text-cafe-espresso">Stock levels</h2>
              <span className="text-sm text-cafe-muted">{activeSupplies.length} active supplies</span>
            </div>
            {isLoading ? (
              <p role="status" className="rounded-xl bg-cafe-card p-6 text-sm text-cafe-muted">Loading stock...</p>
            ) : supplyItems.length === 0 ? (
              <p className="rounded-xl bg-cafe-card p-6 text-sm text-cafe-muted">No supplies yet. Add a supply above to start tracking quantities and costs.</p>
            ) : (
              <ul className="space-y-3">
                {supplyItems.map((item) => {
                  const threshold = effectiveThreshold(item);
                  const low = item.active && item.quantity <= threshold;
                  return (
                    <li key={item.id} className="rounded-2xl border border-cafe-border bg-cafe-card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-cafe-espresso">{item.name}</h3>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${low ? "bg-[#fff0d1] text-[#76501d]" : "bg-[#edf1e8] text-cafe-sage-dark"}`}>
                              {low ? "Low stock" : "Supply"}
                            </span>
                            {!item.active && <span className="rounded-full bg-[#eee5d7] px-2.5 py-1 text-xs text-cafe-muted">Archived</span>}
                          </div>
                          <p className="mt-2 text-sm text-cafe-muted">
                            In stock: <strong className="text-[#342a22]">{amount(item.quantity)} {item.unit}</strong>
                            {" · "}Alert at {amount(threshold)} {item.unit}
                            {" · "}Cost: {item.unit_cost === null ? "not set" : `${formatCurrency(item.unit_cost)}/${item.unit}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => {
                              setEditingSupplyId(
                                editingSupplyId === item.id ? null : item.id,
                              );
                              setSupplyEdit({
                                name: item.name,
                                unit: item.unit,
                                quantity: String(item.quantity),
                                lowStockThreshold: String(
                                  item.low_stock_threshold,
                                ),
                              });
                            }}
                            className="rounded-lg border border-black bg-black px-3 py-2 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-wait disabled:opacity-60"
                          >
                            {editingSupplyId === item.id
                              ? "Close edit"
                              : "Edit supply"}
                          </button>
                          <button type="button" onClick={() => void toggleActivity(item)} className="rounded-lg border border-black bg-black px-3 py-2 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333]">
                            {activityOpen === item.id ? "Hide history" : "Stock history"}
                          </button>
                          <button type="button" disabled={busyId === item.id} onClick={() => void toggleActive(item)} className="rounded-lg border border-black bg-black px-3 py-2 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-wait disabled:opacity-60">
                            {item.active ? "Archive" : "Restore"}
                          </button>
                        </div>
                      </div>
                      {editingSupplyId === item.id && (
                        <div className="mt-4 border-t border-cafe-border pt-4">
                          <h4 className="mb-3 text-sm font-semibold">
                            Edit supply details
                          </h4>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`edit-supply-name-${item.id}`}
                                className="mb-1.5 block text-sm font-medium"
                              >
                                Supply name
                              </label>
                              <input
                                id={`edit-supply-name-${item.id}`}
                                required
                                maxLength={100}
                                value={supplyEdit.name}
                                onChange={(event) =>
                                  setSupplyEdit((current) => ({
                                    ...current,
                                    name: event.target.value,
                                  }))
                                }
                                className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`edit-supply-unit-${item.id}`}
                                className="mb-1.5 block text-sm font-medium"
                              >
                                Unit
                              </label>
                              <input
                                id={`edit-supply-unit-${item.id}`}
                                required
                                maxLength={24}
                                value={supplyEdit.unit}
                                onChange={(event) =>
                                  setSupplyEdit((current) => ({
                                    ...current,
                                    unit: event.target.value,
                                  }))
                                }
                                className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`edit-supply-quantity-${item.id}`}
                                className="mb-1.5 block text-sm font-medium"
                              >
                                On-hand quantity
                              </label>
                              <input
                                id={`edit-supply-quantity-${item.id}`}
                                required
                                type="number"
                                min="0"
                                max="999999999.999"
                                step="0.001"
                                value={supplyEdit.quantity}
                                onChange={(event) =>
                                  setSupplyEdit((current) => ({
                                    ...current,
                                    quantity: event.target.value,
                                  }))
                                }
                                className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`edit-supply-threshold-${item.id}`}
                                className="mb-1.5 block text-sm font-medium"
                              >
                                Low-stock alert threshold
                              </label>
                              <input
                                id={`edit-supply-threshold-${item.id}`}
                                required
                                type="number"
                                min="0"
                                max="999999999.999"
                                step="0.001"
                                value={supplyEdit.lowStockThreshold}
                                onChange={(event) =>
                                  setSupplyEdit((current) => ({
                                    ...current,
                                    lowStockThreshold: event.target.value,
                                  }))
                                }
                                className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm"
                              />
                              <p className="mt-1 text-xs text-cafe-muted">
                                Enter 0 to use the global threshold (
                                {amount(settings.globalLowStockThreshold)}).
                              </p>
                            </div>
                          </div>
                          {supplyEdit.unit.trim() !== item.unit && (
                            <p className="mt-3 rounded-lg bg-[#fff5df] px-3 py-2 text-sm text-[#76501d]">
                              Changing the unit changes how quantities in
                              recipes are interpreted. Review recipes that use
                              this supply after saving.
                            </p>
                          )}
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => void updateSupply(item)}
                              className="h-10 rounded-lg border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-wait disabled:opacity-60"
                            >
                              {busyId === item.id ? "Saving..." : "Save supply"}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => setEditingSupplyId(null)}
                              className="h-10 rounded-lg border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-wait disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {editingCostId === item.id && (
                        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-cafe-border pt-4">
                          <div className="min-w-[220px] flex-1">
                            <label
                              className="mb-1.5 block text-sm font-medium"
                              htmlFor={`edit-cost-${item.id}`}
                            >
                              New cost per {item.unit} (PHP)
                            </label>
                            <input
                              id={`edit-cost-${item.id}`}
                              type="number"
                              min="0"
                              max="99999999.9999"
                              step="0.0001"
                              value={costEditValue}
                              onChange={(event) =>
                                setCostEditValue(event.target.value)
                              }
                              placeholder="Leave blank to clear cost"
                              className="h-10 w-full rounded-lg border border-cafe-border px-3 text-sm"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => void updateSupplyCost(item)}
                            className="h-10 rounded-lg border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-wait disabled:opacity-60"
                          >
                            {busyId === item.id ? "Saving..." : "Save cost"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => {
                              setEditingCostId(null);
                              setCostEditValue("");
                            }}
                            className="h-10 rounded-lg border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {item.active && (
                        <div className="mt-4 grid gap-2 border-t border-cafe-border pt-4 sm:grid-cols-[130px_150px_minmax(180px,1fr)_auto]">
                          <label className="sr-only" htmlFor={`restock-${item.id}`}>Restock quantity in {item.unit}</label>
                          <input
                            id={`restock-${item.id}`}
                            type="number"
                            min="0.001"
                            step="0.001"
                            placeholder={`Quantity (${item.unit})`}
                            value={restockAmounts[item.id] ?? ""}
                            onChange={(event) => setRestockAmounts((current) => ({ ...current, [item.id]: event.target.value }))}
                            className="h-10 rounded-lg border border-cafe-border px-3 text-sm"
                          />
                          <label className="sr-only" htmlFor={`restock-cost-${item.id}`}>Cost per {item.unit} in PHP</label>
                          <input
                            id={`restock-cost-${item.id}`}
                            type="number"
                            min="0"
                            step="0.0001"
                            placeholder={`PHP per ${item.unit}`}
                            value={restockCosts[item.id] ?? ""}
                            onChange={(event) => setRestockCosts((current) => ({ ...current, [item.id]: event.target.value }))}
                            className="h-10 rounded-lg border border-cafe-border px-3 text-sm"
                          />
                          <label className="sr-only" htmlFor={`restock-note-${item.id}`}>Restock note</label>
                          <input
                            id={`restock-note-${item.id}`}
                            maxLength={200}
                            placeholder="Note (optional)"
                            value={restockNotes[item.id] ?? ""}
                            onChange={(event) => setRestockNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                            className="h-10 rounded-lg border border-cafe-border px-3 text-sm"
                          />
                          <button type="button" disabled={busyId === item.id} onClick={() => void restock(item)} className="h-10 rounded-lg border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333] disabled:cursor-wait disabled:opacity-60">
                            {busyId === item.id ? "Saving..." : "Restock"}
                          </button>
                        </div>
                      )}
                      {item.active && editingCostId !== item.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCostId(item.id);
                            setCostEditValue(
                              item.unit_cost === null
                                ? ""
                                : String(item.unit_cost),
                            );
                          }}
                          className="mt-3 h-10 rounded-lg border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333] hover:border-[#333]"
                        >
                          Edit supply cost
                        </button>
                      )}
                      {activityOpen === item.id && (
                        <div className="mt-4 border-t border-cafe-border pt-3">
                          <h4 className="mb-2 text-sm font-semibold">Recent stock movements</h4>
                          {activity[item.id]?.length ? (
                            <ul className="divide-y divide-cafe-border">
                              {activity[item.id].map((movement) => (
                                <li key={movement.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                                  <span>
                                    {movement.movement_type === "restock"
                                      ? "Restock"
                                      : movement.movement_type === "adjustment"
                                        ? "Adjustment"
                                        : "Sale"}{" "}
                                    · {movement.staff_email ?? "Staff"}
                                    {movement.note ? ` · ${movement.note}` : ""}
                                    <span className="ml-2 text-xs text-cafe-muted">
                                      {movementDate.format(new Date(movement.created_at))}
                                    </span>
                                  </span>
                                  <span className={movement.quantity_change > 0 ? "text-cafe-sage-dark" : "text-[#9a5143]"}>
                                    {movement.quantity_change > 0 ? "+" : ""}{amount(movement.quantity_change)} {movement.unit ?? item.unit}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-cafe-muted">No stock movement recorded yet.</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
