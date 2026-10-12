"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { currency } from "@/lib/currency";
import ManagementSidebar from "../management-sidebar";

const productOptions = [
  { icon: "☕", color: "latte" },
  { icon: "🥛", color: "oat" },
  { icon: "🧋", color: "cold-brew" },
  { icon: "🍵", color: "matcha" },
  { icon: "🫖", color: "chai" },
  { icon: "🥐", color: "pastry" },
  { icon: "🧁", color: "berry" },
  { icon: "🥑", color: "avocado" },
] as const;

type ProductColor = (typeof productOptions)[number]["color"];
type Category = "Coffee" | "Non-Coffee" | "Tea" | "Bakery";

type Product = {
  id: string;
  name: string;
  description: string;
  category: Category;
  price: number;
  large_price: number | null;
  unit_cost: number | null;
  large_unit_cost: number | null;
  icon: string;
  color: ProductColor;
  active: boolean;
};

type Supply = { id: string; name: string; unit: string };
type RecipeRow = { inventoryItemId: string; quantity: string };

type ProductForm = {
  name: string;
  description: string;
  category: Category;
  price: string;
  largePrice: string;
  unitCost: string;
  largeUnitCost: string;
  icon: string;
  color: ProductColor;
};

const emptyForm: ProductForm = {
  name: "",
  description: "",
  category: "Coffee",
  price: "",
  largePrice: "",
  unitCost: "",
  largeUnitCost: "",
  icon: "☕",
  color: "latte",
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

export default function MenuManagerClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [role, setRole] = useState<"manager" | "admin">("manager");
  const [recipeProductId, setRecipeProductId] = useState("");
  const [recipeVariant, setRecipeVariant] = useState<"regular" | "large">("regular");
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([]);
  const [isLoadingRecipe, setIsLoadingRecipe] = useState(false);
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);

  const loadProducts = useCallback(async () => {
    setErrorMessage("");
    const supabase = createSupabaseBrowserClient();
    const [productsResult, suppliesResult] = await Promise.all([
      supabase
      .from("products")
      .select("id, name, description, category, price, large_price, unit_cost, large_unit_cost, icon, color, active")
      .order("name"),
      supabase
        .from("inventory_items")
        .select("id, name, unit")
        .eq("item_type", "supply")
        .eq("active", true)
        .order("name"),
    ]);

    if (productsResult.error) throw productsResult.error;
    if (suppliesResult.error) throw suppliesResult.error;
    setProducts((productsResult.data ?? []) as Product[]);
    setSupplies((suppliesResult.data ?? []) as Supply[]);
  }, []);

  useEffect(() => {
    let isCurrent = true;
    async function load() {
      try {
        const { data: currentRole, error: roleError } =
          await createSupabaseBrowserClient().rpc("current_staff_role");
        if (roleError) throw roleError;
        if (currentRole !== "manager" && currentRole !== "admin") {
          throw new Error("Manager or admin access is required.");
        }
        if (isCurrent) setRole(currentRole);
        await loadProducts();
      } catch (error) {
        if (isCurrent) setErrorMessage(`Could not load menu items: ${errorText(error)}`);
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }
    void load();
    return () => {
      isCurrent = false;
    };
  }, [loadProducts]);

  const loadRecipe = useCallback(async (
    productId: string,
    variant: "regular" | "large",
  ) => {
    if (!productId) {
      setRecipeRows([]);
      setIsLoadingRecipe(false);
      return;
    }
    setIsLoadingRecipe(true);
    setErrorMessage("");
    try {
      const { data, error } = await createSupabaseBrowserClient().rpc(
        "list_product_recipes",
      );
      if (error) throw error;
      if (!Array.isArray(data)) {
        throw new Error("Supabase returned an invalid recipe list.");
      }
      const rows = data
        .filter(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "product_id" in entry &&
            entry.product_id === productId &&
            "variant" in entry &&
            entry.variant === variant,
        )
        .map((entry) => {
          if (
            typeof entry !== "object" ||
            entry === null ||
            !("inventory_item_id" in entry) ||
            typeof entry.inventory_item_id !== "string" ||
            !("quantity_per_product" in entry)
          ) {
            throw new Error("Supabase returned an invalid recipe ingredient.");
          }
          return {
            inventoryItemId: entry.inventory_item_id,
            quantity: String(entry.quantity_per_product),
          };
        });
      setRecipeRows(rows);
    } catch (error) {
      setErrorMessage(`Could not load product recipe: ${errorText(error)}`);
    } finally {
      setIsLoadingRecipe(false);
    }
  }, []);

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipeProductId) {
      setErrorMessage("Choose a menu product for the recipe.");
      return;
    }
    const ingredients = recipeRows.map((row) => ({
      inventory_item_id: row.inventoryItemId,
      quantity: Number(row.quantity),
    }));
    if (
      ingredients.some(
        (ingredient) =>
          !ingredient.inventory_item_id ||
          !Number.isFinite(ingredient.quantity) ||
          ingredient.quantity <= 0,
      )
    ) {
      setErrorMessage("Choose a supply and enter a positive quantity for every recipe row.");
      return;
    }

    setIsSavingRecipe(true);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "save_product_recipe",
        {
          p_product_id: recipeProductId,
          p_variant: recipeVariant,
          p_ingredients: ingredients,
        },
      );
      if (error) throw error;
      setNotice("Product recipe saved.");
      await loadRecipe(recipeProductId, recipeVariant);
    } catch (error) {
      setErrorMessage(`Could not save product recipe: ${errorText(error)}`);
    } finally {
      setIsSavingRecipe(false);
    }
  }

  const activeProducts = products.filter((product) => product.active);
  const selectedRecipeProduct = activeProducts.find(
    (product) => product.id === recipeProductId,
  );

  function startEditing(product: Product) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description,
      category: product.category,
      price: product.price.toFixed(2),
      largePrice: product.large_price?.toFixed(2) ?? "",
      unitCost: product.unit_cost?.toFixed(2) ?? "",
      largeUnitCost: product.large_unit_cost?.toFixed(2) ?? "",
      icon: product.icon,
      color: product.color,
    });
    setNotice("");
    setErrorMessage("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const description = form.description.trim();
    const price = Number(form.price);
    const largePrice = form.largePrice.trim() ? Number(form.largePrice) : null;
    const unitCost = form.unitCost.trim() ? Number(form.unitCost) : null;
    const largeUnitCost = form.largeUnitCost.trim()
      ? Number(form.largeUnitCost)
      : null;
    if (
      !name ||
      !description ||
      !Number.isFinite(price) ||
      price < 0 ||
      (largePrice !== null &&
        (!Number.isFinite(largePrice) || largePrice < price)) ||
      (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) ||
      (largeUnitCost !== null &&
        (!Number.isFinite(largeUnitCost) ||
          largeUnitCost < 0 ||
          largePrice === null))
    ) {
      setErrorMessage("Enter valid details. Large price must be blank or at least the Regular price; costs must be blank or zero and above.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setNotice("");

    try {
      const supabase = createSupabaseBrowserClient();
      const productData = {
        name,
        description,
        category: form.category,
        price: Number(price.toFixed(2)),
        large_price:
          largePrice === null ? null : Number(largePrice.toFixed(2)),
        unit_cost: unitCost === null ? null : Number(unitCost.toFixed(2)),
        large_unit_cost:
          largeUnitCost === null ? null : Number(largeUnitCost.toFixed(2)),
        icon: form.icon,
        color: form.color,
      };
      const result = editingId
        ? await supabase
            .from("products")
            .update(productData)
            .eq("id", editingId)
            .select("id")
            .single()
        : await supabase
            .from("products")
            .insert({
              id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"}-${crypto.randomUUID()}`,
              ...productData,
            })
            .select("id")
            .single();

      if (result.error) throw result.error;
      await loadProducts();
      setNotice(editingId ? "Menu item updated." : "Menu item added.");
      resetForm();
    } catch (error) {
      setErrorMessage(`Could not save menu item: ${errorText(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(product: Product) {
    setBusyProductId(product.id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient()
        .from("products")
        .update({ active: !product.active })
        .eq("id", product.id);
      if (error) throw error;
      await loadProducts();
      setNotice(
        product.active
          ? `${product.name} was marked unavailable.`
          : `${product.name} is back on the menu.`,
      );
    } catch (error) {
      setErrorMessage(`Could not update menu availability: ${errorText(error)}`);
    } finally {
      setBusyProductId(null);
    }
  }

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:min-h-screen lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <ManagementSidebar role={role} />
        <div className="min-w-0 flex-1 px-0 py-2 sm:py-4 lg:px-8 lg:py-8">
        <div className="mb-7 mt-5">
          <p className="mb-2 text-sm font-medium text-cafe-sage-dark">
            KAPE NA NAMAN
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Manage menu
          </h1>
          <p className="mt-2 text-sm text-[#77736b]">
            Add products, update prices, or mark an item unavailable. Items are
            kept in the database so past orders remain unchanged.
          </p>
        </div>

        <section className="mb-8 rounded-2xl border border-cafe-border bg-cafe-card p-5 sm:p-7">
          <h2 className="text-lg font-semibold">
            {editingId ? "Edit menu item" : "Add a menu item"}
          </h2>
          <form
            className="mt-5 grid gap-4 sm:grid-cols-2"
            onSubmit={saveProduct}
          >
            <div>
              <label htmlFor="product-name" className="mb-1.5 block text-sm font-medium">
                Name
              </label>
              <input
                id="product-name"
                required
                maxLength={80}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                className="h-11 w-full rounded-lg border border-[#e2dfd8] px-3 text-sm outline-none focus:border-[#788f78]"
              />
            </div>
            <div>
              <label htmlFor="product-category" className="mb-1.5 block text-sm font-medium">
                Category
              </label>
              <select
                id="product-category"
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value as Category })
                }
                className="h-11 w-full rounded-lg border border-[#e2dfd8] bg-white px-3 text-sm outline-none focus:border-[#788f78]"
              >
                <option>Coffee</option>
                <option>Non-Coffee</option>
                <option>Tea</option>
                <option>Bakery</option>
              </select>
            </div>
            <div>
              <label htmlFor="product-price" className="mb-1.5 block text-sm font-medium">
                Regular price (PHP)
              </label>
              <input
                id="product-price"
                type="number"
                min="0"
                max="99999999"
                step="0.01"
                required
                value={form.price}
                onChange={(event) =>
                  setForm({ ...form, price: event.target.value })
                }
                className="h-11 w-full rounded-lg border border-[#e2dfd8] px-3 text-sm outline-none focus:border-[#788f78]"
              />
            </div>
            <div>
              <label htmlFor="product-large-price" className="mb-1.5 block text-sm font-medium">
                Large price (PHP, optional)
              </label>
              <input
                id="product-large-price"
                type="number"
                min="0"
                max="99999999"
                step="0.01"
                value={form.largePrice}
                onChange={(event) =>
                  setForm({ ...form, largePrice: event.target.value })
                }
                className="h-11 w-full rounded-lg border border-[#e2dfd8] px-3 text-sm outline-none focus:border-[#788f78]"
              />
            </div>
            <div>
              <label htmlFor="product-unit-cost" className="mb-1.5 block text-sm font-medium">
                Regular item cost (PHP, optional)
              </label>
              <input
                id="product-unit-cost"
                type="number"
                min="0"
                max="99999999"
                step="0.01"
                value={form.unitCost}
                onChange={(event) =>
                  setForm({ ...form, unitCost: event.target.value })
                }
                className="h-11 w-full rounded-lg border border-[#e2dfd8] px-3 text-sm outline-none focus:border-[#788f78]"
              />
            </div>
            <div>
              <label htmlFor="product-large-unit-cost" className="mb-1.5 block text-sm font-medium">
                Large item cost (PHP, optional)
              </label>
              <input
                id="product-large-unit-cost"
                type="number"
                min="0"
                max="99999999"
                step="0.01"
                value={form.largeUnitCost}
                onChange={(event) =>
                  setForm({ ...form, largeUnitCost: event.target.value })
                }
                className="h-11 w-full rounded-lg border border-[#e2dfd8] px-3 text-sm outline-none focus:border-[#788f78]"
              />
            </div>
            <div>
              <label htmlFor="product-description" className="mb-1.5 block text-sm font-medium">
                Description
              </label>
              <input
                id="product-description"
                required
                maxLength={160}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                className="h-11 w-full rounded-lg border border-[#e2dfd8] px-3 text-sm outline-none focus:border-[#788f78]"
              />
            </div>
            <div>
              <label htmlFor="product-icon" className="mb-1.5 block text-sm font-medium">
                Menu icon
              </label>
              <select
                id="product-icon"
                value={form.icon}
                onChange={(event) => {
                  const option = productOptions.find(
                    (item) => item.icon === event.target.value,
                  );
                  if (option) {
                    setForm({
                      ...form,
                      icon: option.icon,
                      color: option.color,
                    });
                  }
                }}
                className="h-11 w-full rounded-lg border border-[#e2dfd8] bg-white px-3 text-lg outline-none focus:border-[#788f78]"
              >
                {productOptions.map((option) => (
                  <option key={option.icon} value={option.icon}>
                    {option.icon}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={isSaving}
                className="h-11 rounded-xl bg-black px-5 text-sm font-medium text-white transition hover:bg-[#333] disabled:cursor-wait disabled:opacity-60"
              >
                {isSaving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Add item"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="h-11 rounded-xl border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333]"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          {errorMessage && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {errorMessage}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-4 rounded-lg bg-[#edf3eb] px-3 py-2 text-sm text-[#344b3b]">
              {notice}
            </p>
          )}
        </section>

        <section
          aria-labelledby="product-recipes-heading"
          className="mb-8 rounded-2xl border border-cafe-border bg-cafe-card p-5 sm:p-7"
        >
          <h2 id="product-recipes-heading" className="text-lg font-semibold">
            Product recipes
          </h2>
          <p className="mt-1 text-sm text-[#77736b]">
            Select the supplies and amounts needed to make one menu product.
            Orders deduct these amounts from supply inventory automatically.
          </p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void saveRecipe(event)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="recipe-product" className="mb-1.5 block text-sm font-medium">
                  Menu product
                </label>
                <select
                  id="recipe-product"
                  value={recipeProductId}
                  onChange={(event) => {
                    const productId = event.target.value;
                    setRecipeProductId(productId);
                    setRecipeVariant("regular");
                    void loadRecipe(productId, "regular");
                  }}
                  className="h-11 w-full rounded-lg border border-[#e2dfd8] bg-white px-3 text-sm"
                >
                  <option value="">Choose product</option>
                  {activeProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="recipe-variant" className="mb-1.5 block text-sm font-medium">
                  Drink size
                </label>
                <select
                  id="recipe-variant"
                  value={recipeVariant}
                  onChange={(event) => {
                    const variant = event.target.value as "regular" | "large";
                    setRecipeVariant(variant);
                    void loadRecipe(recipeProductId, variant);
                  }}
                  disabled={
                    selectedRecipeProduct?.large_price === null ||
                    selectedRecipeProduct?.large_price === undefined
                  }
                  className="h-11 w-full rounded-lg border border-[#e2dfd8] bg-white px-3 text-sm disabled:bg-[#f3eee5]"
                >
                  <option value="regular">Regular</option>
                  {selectedRecipeProduct?.large_price !== null &&
                    selectedRecipeProduct?.large_price !== undefined && (
                      <option value="large">Large</option>
                    )}
                </select>
              </div>
            </div>
            {selectedRecipeProduct?.large_price !== null &&
              selectedRecipeProduct?.large_price !== undefined && (
                <p className="text-xs text-[#77736b]">
                  If no Large recipe is saved, Large orders use the Regular recipe.
                </p>
              )}
            {!recipeProductId ? (
              <p className="rounded-lg bg-[#f8f4ec] p-4 text-sm text-[#77736b]">
                Choose a menu product to view or edit its recipe.
              </p>
            ) : isLoadingRecipe ? (
              <p role="status" className="rounded-lg bg-[#f8f4ec] p-4 text-sm text-[#77736b]">
                Loading recipe...
              </p>
            ) : (
              <>
                {recipeRows.length > 0 && (
                  <div className="space-y-2">
                    {recipeRows.map((row, index) => {
                      const supply = supplies.find(
                        (item) => item.id === row.inventoryItemId,
                      );
                      return (
                        <div
                          key={`${recipeProductId}-${recipeVariant}-${index}`}
                          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
                        >
                          <label className="sr-only" htmlFor={`recipe-supply-${index}`}>
                            Supply {index + 1}
                          </label>
                          <select
                            id={`recipe-supply-${index}`}
                            required
                            value={row.inventoryItemId}
                            onChange={(event) =>
                              setRecipeRows((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, inventoryItemId: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="h-10 rounded-lg border border-[#e2dfd8] bg-white px-3 text-sm"
                          >
                            <option value="">Choose supply</option>
                            {supplies.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ({item.unit})
                              </option>
                            ))}
                          </select>
                          <label className="sr-only" htmlFor={`recipe-quantity-${index}`}>
                            Amount per drink
                          </label>
                          <input
                            id={`recipe-quantity-${index}`}
                            required
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={row.quantity}
                            onChange={(event) =>
                              setRecipeRows((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, quantity: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            placeholder={supply ? `Amount (${supply.unit})` : "Amount per drink"}
                            className="h-10 rounded-lg border border-[#e2dfd8] px-3 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setRecipeRows((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                            className="h-10 rounded-lg border border-black bg-black px-3 text-sm font-medium text-white hover:bg-[#333]"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setRecipeRows((current) => [
                        ...current,
                        { inventoryItemId: "", quantity: "1" },
                      ])
                    }
                    disabled={supplies.length === 0}
                    className="h-10 rounded-lg border border-black bg-black px-4 text-sm font-medium text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Add supply
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingRecipe || isLoadingRecipe || !recipeProductId}
                    className="h-10 rounded-lg bg-black px-4 text-sm font-medium text-white hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingRecipe ? "Saving..." : "Save recipe"}
                  </button>
                  {recipeRows.length === 0 && (
                    <span className="text-xs text-[#77736b]">
                      No ingredients listed. Saving this clears the recipe.
                    </span>
                  )}
                </div>
                {supplies.length === 0 && (
                  <p className="text-xs text-[#9a5143]">
                    Add active supply items in Inventory before creating a recipe.
                  </p>
                )}
              </>
            )}
          </form>
        </section>

        <section aria-labelledby="menu-items-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="menu-items-heading" className="text-lg font-semibold">
              Menu items
            </h2>
            <span className="text-sm text-[#88847b]">{products.length} total</span>
          </div>
          {isLoading ? (
            <p role="status" className="rounded-xl bg-white p-6 text-sm text-[#77736b]">
              Loading menu items...
            </p>
          ) : products.length === 0 ? (
            <p className="rounded-xl bg-white p-6 text-sm text-[#77736b]">
              No menu items yet.
            </p>
          ) : (
            <ul className="divide-y divide-[#eeece6] rounded-2xl border border-[#e9e6e0] bg-white px-5">
              {products.map((product) => (
                <li
                  key={product.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f4f2ee] text-2xl">
                      {product.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{product.name}</p>
                      <p className="truncate text-xs text-[#88847b]">
                        {product.category} · {product.description}
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        {currency.format(product.price)}
                        {product.large_price !== null &&
                          ` / ${currency.format(product.large_price)}`}
                        {!product.active && (
                          <span className="ml-2 text-xs font-normal text-[#9a6555]">
                            Unavailable
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[#88847b]">
                        Item cost: {product.unit_cost === null ? "Not set" : currency.format(product.unit_cost)}
                        {product.large_price !== null &&
                          ` / ${product.large_unit_cost === null ? "Not set" : currency.format(product.large_unit_cost)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => startEditing(product)}
                      className="rounded-lg border border-black bg-black px-3 py-2 text-sm font-medium text-white hover:bg-[#333]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyProductId === product.id}
                      onClick={() => void toggleActive(product)}
                      className="rounded-lg border border-black bg-black px-3 py-2 text-sm font-medium text-white hover:bg-[#333] disabled:cursor-wait disabled:opacity-60"
                    >
                      {busyProductId === product.id
                        ? "Saving..."
                        : product.active
                          ? "Mark unavailable"
                          : "Reactivate"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </div>
    </main>
  );
}
