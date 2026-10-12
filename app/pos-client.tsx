"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { currency } from "@/lib/currency";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const categories = ["All", "Coffee", "Non-Coffee", "Tea", "Bakery"] as const;
type Category = (typeof categories)[number];
type MenuCategory = Exclude<Category, "All">;
type ProductColor =
  | "latte"
  | "oat"
  | "cold-brew"
  | "matcha"
  | "chai"
  | "pastry"
  | "berry"
  | "avocado";

const productColors: Record<ProductColor, string> = {
  latte: "bg-[#f5e9dc]",
  oat: "bg-[#eee9df]",
  "cold-brew": "bg-[#e6ece8]",
  matcha: "bg-[#e8eddf]",
  chai: "bg-[#f1e8dd]",
  pastry: "bg-[#f5edda]",
  berry: "bg-[#f0e8eb]",
  avocado: "bg-[#e8eddf]",
};

type Product = {
  id: string;
  name: string;
  description: string;
  category: MenuCategory;
  price: number;
  largePrice: number | null;
  icon: string;
  color: ProductColor;
};

type CartItem = {
  product: Product;
  size: "regular" | "large";
  quantity: number;
};

function parseProducts(rows: unknown): Product[] {
  if (!Array.isArray(rows)) {
    throw new Error("Supabase returned an invalid menu response.");
  }

  return rows.map((row: unknown) => {
    if (typeof row !== "object" || row === null) {
      throw new Error("Supabase returned an invalid menu item.");
    }

    const product = row as Record<string, unknown>;
    const price = Number(product.price);
    const largePrice =
      product.large_price === null || product.large_price === undefined
        ? null
        : Number(product.large_price);
    if (
      typeof product.id !== "string" ||
      typeof product.name !== "string" ||
      typeof product.description !== "string" ||
      typeof product.category !== "string" ||
      !categories.includes(product.category as Category) ||
      product.category === "All" ||
      !Number.isFinite(price) ||
      (largePrice !== null &&
        (!Number.isFinite(largePrice) || largePrice < price)) ||
      typeof product.icon !== "string" ||
      typeof product.color !== "string" ||
      !Object.hasOwn(productColors, product.color)
    ) {
      throw new Error("A menu item in Supabase has invalid or missing fields.");
    }

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category as MenuCategory,
      price,
      largePrice,
      icon: product.icon,
      color: product.color as ProductColor,
    };
  });
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

export default function PosClient({
  email,
  role,
}: {
  email: string;
  role: "staff" | "manager" | "admin";
}) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sizeSelection, setSizeSelection] = useState<Product | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const [orderError, setOrderError] = useState("");
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadMenu() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("products")
          .select("id, name, description, category, price, large_price, icon, color")
          .eq("active", true)
          .order("name");

        if (error) throw error;
        const menu = parseProducts(data);
        if (isCurrent) setProducts(menu);
      } catch (error) {
        if (isCurrent) setMenuError(describeError(error));
      } finally {
        if (isCurrent) setIsLoadingMenu(false);
      }
    }

    void loadMenu();
    return () => {
      isCurrent = false;
    };
  }, []);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        activeCategory === "All" || product.category === activeCategory;
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.description.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, products, search]);

  const itemCount = cart.reduce((count, item) => count + item.quantity, 0);
  const subtotal = cart.reduce(
    (total, item) =>
      total +
      (item.size === "large"
        ? (item.product.largePrice ?? item.product.price)
        : item.product.price) *
        item.quantity,
    0,
  );
  const tax = subtotal * 0.08;
  const total = subtotal + tax;

  function addToCart(product: Product, size: "regular" | "large" = "regular") {
    setOrderMessage("");
    setCart((currentCart) => {
      const existingItem = currentCart.find(
        (item) => item.product.id === product.id && item.size === size,
      );
      if (existingItem) {
        return currentCart.map((item) =>
          item.product.id === product.id && item.size === size
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...currentCart, { product, size, quantity: 1 }];
    });
  }

  function changeQuantity(
    productId: string,
    size: "regular" | "large",
    change: number,
  ) {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          item.product.id === productId && item.size === size
            ? { ...item, quantity: item.quantity + change }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  async function placeOrder() {
    if (cart.length === 0) return;
    setIsSavingOrder(true);
    setOrderMessage("");
    setOrderError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("place_order", {
        p_items: cart.map(({ product, quantity, size }) => ({
          product_id: product.id,
          variant: size,
          quantity,
        })),
      });
      if (error) throw error;
      setOrderMessage("Order saved to Supabase. No payment was processed.");
      setCart([]);
    } catch (error) {
      setOrderError(`Could not save the order: ${describeError(error)}`);
    } finally {
      setIsSavingOrder(false);
    }
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      setOrderError(`Could not sign out: ${describeError(error)}`);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <header className="border-b border-cafe-border bg-cafe-card shadow-[0_2px_12px_rgba(74,52,40,0.04)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cafe-espresso text-xl text-[#fffaf0] shadow-sm">
              ☕
            </div>
            <div>
              <p className="font-semibold tracking-tight text-cafe-espresso">KAPE NA NAMAN</p>
              <p className="text-xs text-cafe-muted">Point of sale</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {role !== "staff" && (
              <Link
                href="/dashboard"
                className="rounded-lg border border-cafe-border bg-[#f8f4ec] px-3 py-2 text-sm font-medium text-cafe-espresso transition hover:border-[#cfc2af] hover:bg-[#f0e8db]"
              >
                Management
              </Link>
            )}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{email}</p>
              <p className="text-xs capitalize text-cafe-muted">{role}</p>
            </div>
            <span className="rounded-full bg-[#eee5d7] px-3 py-1.5 text-xs font-semibold capitalize text-cafe-espresso sm:hidden">
              {role}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-cafe-border px-3 py-2 text-sm font-medium transition hover:bg-[#f0e8db]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 lg:py-8">
        <section aria-labelledby="menu-heading">
          <div className="mb-6 rounded-3xl bg-[#eee5d7] px-6 py-7 sm:px-8 sm:py-9">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">
              FRESHLY MADE, JUST FOR YOU
            </p>
            <h1
              id="menu-heading"
              className="text-3xl font-semibold tracking-tight text-cafe-espresso sm:text-4xl"
            >
              Your daily ritual.
            </h1>
            <p className="mt-2 text-sm text-[#75695d]">
              What can we make for you today?
            </p>
          </div>

          <label className="mb-5 flex h-12 max-w-xl items-center gap-3 rounded-xl border border-cafe-border bg-cafe-card px-4 text-cafe-muted shadow-[0_2px_10px_rgba(74,52,40,0.03)] focus-within:border-cafe-sage">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search the menu</span>
            <input
              className="h-full w-full bg-transparent text-sm text-[#342a22] outline-none placeholder:text-[#a39789]"
              placeholder="Search coffee, tea, bakery..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div
            aria-label="Menu categories"
            className="mb-6 flex gap-2 overflow-x-auto pb-1"
          >
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={activeCategory === category}
                onClick={() => setActiveCategory(category)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeCategory === category
                    ? "bg-cafe-sage-dark text-white shadow-sm"
                    : "border border-cafe-border bg-cafe-card text-[#6e6256] hover:bg-[#eee5d7]"
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {menuError ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-sm text-red-800"
            >
              <p className="font-semibold">Could not load the menu from Supabase.</p>
              <p className="mt-1">{menuError}</p>
              <p className="mt-2">
                Check your project URL/key and run the included database setup SQL.
              </p>
            </div>
          ) : isLoadingMenu ? (
            <p role="status" className="py-12 text-center text-sm text-cafe-muted">
              Loading menu from Supabase...
            </p>
          ) : visibleProducts.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() =>
                    product.largePrice === null
                      ? addToCart(product)
                      : setSizeSelection(product)
                  }
                  className="group rounded-2xl border border-cafe-border bg-cafe-card p-3 text-left shadow-[0_3px_14px_rgba(74,52,40,0.035)] transition hover:-translate-y-0.5 hover:border-[#bdc6b5] hover:shadow-[0_10px_24px_rgba(74,52,40,0.1)]"
                >
                  <div
                    className={`flex h-32 items-center justify-center rounded-xl text-5xl ${productColors[product.color]}`}
                    aria-hidden="true"
                  >
                    {product.icon}
                  </div>
                  <div className="flex items-start justify-between gap-2 px-1 pb-1 pt-4">
                    <div>
                      <h2 className="font-semibold">{product.name}</h2>
                      <p className="mt-1 text-xs leading-5 text-cafe-muted">
                        {product.description}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-cafe-espresso">
                      {product.largePrice === null
                        ? currency.format(product.price)
                        : `${currency.format(product.price)} / ${currency.format(product.largePrice)}`}
                    </span>
                  </div>
                  <p className="px-1 pt-2 text-xs font-medium text-cafe-sage group-hover:text-cafe-sage-dark">
                    + Add to order
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#d3c7b8] bg-cafe-card px-6 py-12 text-center">
              <p className="font-medium">No menu items found</p>
              <p className="mt-1 text-sm text-[#88847b]">
                Try another search or choose a different category.
              </p>
            </div>
          )}
        </section>

        <aside
          aria-labelledby="order-heading"
          className="h-fit rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_8px_28px_rgba(74,52,40,0.07)] sm:p-6 lg:sticky lg:top-6"
        >
          <div className="flex items-center justify-between border-b border-cafe-border pb-5">
            <div>
              <h2 id="order-heading" className="text-lg font-semibold">
                Current order
              </h2>
              <p className="mt-1 text-sm text-cafe-muted">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </p>
            </div>
            <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-[#eee5d7] px-2 text-sm font-semibold text-cafe-espresso">
              {itemCount}
            </span>
          </div>

          {cart.length === 0 ? (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#eee5d7] text-2xl">
                🛍️
              </div>
              <p className="font-medium">Your order is empty</p>
              <p className="mt-1 text-sm text-cafe-muted">
                Choose something delicious from the menu.
              </p>
            </div>
          ) : (
            <ul className="max-h-80 divide-y divide-cafe-border overflow-y-auto">
              {cart.map(({ product, quantity, size }) => (
                <li
                  key={`${product.id}-${size}`}
                  className="flex items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {product.name} · {size === "large" ? "Large" : "Regular"}
                    </p>
                    <p className="mt-1 text-xs text-cafe-muted">
                      {currency.format(
                        size === "large"
                          ? (product.largePrice ?? product.price)
                          : product.price,
                      )}{" "}
                      each
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Remove one ${size} ${product.name}`}
                      onClick={() => changeQuantity(product.id, size, -1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-cafe-border text-cafe-espresso transition hover:bg-[#eee5d7]"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm">{quantity}</span>
                    <button
                      type="button"
                      aria-label={`Add one ${size} ${product.name}`}
                      onClick={() => changeQuantity(product.id, size, 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-cafe-border text-cafe-espresso transition hover:bg-[#eee5d7]"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t border-cafe-border pt-5 text-sm">
            <div className="flex justify-between text-cafe-muted">
              <span>Subtotal</span>
              <span>{currency.format(subtotal)}</span>
            </div>
            <div className="flex justify-between text-cafe-muted">
              <span>Estimated tax (8%)</span>
              <span>{currency.format(tax)}</span>
            </div>
            <div className="flex justify-between pt-1 text-base font-semibold">
              <span>Total</span>
              <span>{currency.format(total)}</span>
            </div>
          </div>

          {orderMessage && (
            <p
              role="status"
              className="mt-4 rounded-lg bg-[#edf1e8] px-3 py-2 text-sm text-cafe-sage-dark"
            >
              {orderMessage}
            </p>
          )}
          {orderError && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {orderError}
            </p>
          )}

          <button
            type="button"
            disabled={cart.length === 0 || isSavingOrder}
            onClick={placeOrder}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-cafe-sage-dark px-4 font-medium text-white transition hover:bg-[#43563d] disabled:cursor-not-allowed disabled:bg-[#b8beb5]"
          >
            {isSavingOrder
              ? "Saving order..."
              : `Place order · ${currency.format(total)}`}
          </button>
          <p className="mt-3 text-center text-xs text-cafe-muted">
            No payment processing
          </p>
        </aside>
      </div>
      {sizeSelection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#241b15]/50 px-5 py-8"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSizeSelection(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="size-selection-title"
            className="w-full max-w-sm rounded-2xl border border-cafe-border bg-cafe-card p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2
                  id="size-selection-title"
                  className="text-xl font-semibold text-cafe-espresso"
                >
                  Choose a size
                </h2>
                <p className="mt-1 text-sm text-cafe-muted">
                  {sizeSelection.name}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close size selection"
                onClick={() => setSizeSelection(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-cafe-border hover:bg-[#eee5d7]"
              >
                ×
              </button>
            </div>
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => {
                  addToCart(sizeSelection, "regular");
                  setSizeSelection(null);
                }}
                className="flex items-center justify-between rounded-xl border border-cafe-border px-4 py-4 text-left transition hover:border-cafe-sage hover:bg-[#f3f4ed]"
              >
                <span className="font-medium">Regular</span>
                <span className="font-semibold text-cafe-espresso">
                  {currency.format(sizeSelection.price)}
                </span>
              </button>
              {sizeSelection.largePrice !== null && (
                <button
                  type="button"
                  onClick={() => {
                    addToCart(sizeSelection, "large");
                    setSizeSelection(null);
                  }}
                  className="flex items-center justify-between rounded-xl border border-cafe-border px-4 py-4 text-left transition hover:border-cafe-sage hover:bg-[#f3f4ed]"
                >
                  <span className="font-medium">Large</span>
                  <span className="font-semibold text-cafe-espresso">
                    {currency.format(sizeSelection.largePrice)}
                  </span>
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
