"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useStoreSettings } from "@/lib/store-settings";
import RegisterFinancialActivity from "./register-financial-activity";

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

type PaymentMethod = "cash" | "card" | "e_wallet";
type DiscountType = "pwd_senior";

type Receipt = {
  orderId: string;
  items: CartItem[];
  subtotal: number;
  discountType: DiscountType | null;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  changeDue: number;
  completedAt: Date;
  storeName: string;
  address: string;
  phone: string;
  vatTin: string;
  receiptFooter: string;
};

type ProductAvailability = {
  available: boolean;
  unavailableIngredients: string[];
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  e_wallet: "E-wallet",
};

const discountLabel = "PWD / Senior Citizen";

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
  const {
    settings,
    formatCurrency,
    isLoading: isLoadingSettings,
    error: storeSettingsError,
  } = useStoreSettings();
  const [products, setProducts] = useState<Product[]>([]);
  const [availability, setAvailability] = useState<Record<string, ProductAvailability>>({});
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sizeSelection, setSizeSelection] = useState<Product | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [orderError, setOrderError] = useState("");
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [attendancePin, setAttendancePin] = useState("");
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [attendanceError, setAttendanceError] = useState("");
  const [isPunchingAttendance, setIsPunchingAttendance] = useState(false);

  const loadAvailability = useCallback(async () => {
    const { data: rows, error } =
      await createSupabaseBrowserClient().rpc("register_product_availability");
    if (error) throw error;
    if (!Array.isArray(rows)) {
      throw new Error("Supabase returned invalid product availability.");
    }
    const nextAvailability: Record<string, ProductAvailability> = {};
    for (const row of rows) {
      if (
        typeof row !== "object" ||
        row === null ||
        !("product_id" in row) ||
        typeof row.product_id !== "string" ||
        !("variant" in row) ||
        (row.variant !== "regular" && row.variant !== "large") ||
        !("is_available" in row) ||
        typeof row.is_available !== "boolean" ||
        !("unavailable_ingredients" in row) ||
        !Array.isArray(row.unavailable_ingredients) ||
        !row.unavailable_ingredients.every(
          (name: unknown) => typeof name === "string",
        )
      ) {
        throw new Error("Supabase returned invalid product availability.");
      }
      nextAvailability[`${row.product_id}:${row.variant}`] = {
        available: row.is_available,
        unavailableIngredients: row.unavailable_ingredients,
      };
    }
    setAvailability(nextAvailability);
  }, []);

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
        await loadAvailability();
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
  }, [loadAvailability]);

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
  const discountAmount =
    discountType === null
      ? 0
      : Math.round((subtotal * 0.1 + Number.EPSILON) * 100) / 100;
  const discountedSubtotal = subtotal - discountAmount;
  const total = discountedSubtotal;
  const cashAmountReceived = Number(amountReceived);
  const isPaymentValid =
    paymentMethod !== "cash" ||
    (amountReceived.trim() !== "" &&
      Number.isFinite(cashAmountReceived) &&
      cashAmountReceived >= total);
  const isCheckoutDisabled =
    cart.length === 0 ||
    isSavingOrder ||
    !isPaymentValid ||
    isLoadingSettings ||
    Boolean(storeSettingsError);

  function addToCart(product: Product, size: "regular" | "large" = "regular") {
    if (!availability[`${product.id}:${size}`]?.available) {
      setOrderError("That product size is unavailable because an ingredient is out of stock.");
      return;
    }
    setOrderError("");
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
    const nextCart = cart
      .map((item) =>
        item.product.id === productId && item.size === size
          ? { ...item, quantity: item.quantity + change }
          : item,
      )
      .filter((item) => item.quantity > 0);
    setCart(nextCart);
    if (nextCart.length === 0) {
      setDiscountType(null);
      void loadAvailability().catch((error: unknown) =>
        setMenuError(
          `Could not refresh stock availability: ${describeError(error)}`,
        ),
      );
    }
  }

  async function placeOrder() {
    if (cart.length === 0) return;
    if (isLoadingSettings || storeSettingsError) {
      setOrderError(
        "Store settings are still loading or unavailable. Refresh the register before completing an order.",
      );
      return;
    }
    if (!isPaymentValid) {
      setOrderError("Enter an amount received that covers the order total.");
      return;
    }

    setIsSavingOrder(true);
    setOrderError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const paymentReceived =
        paymentMethod === "cash" ? cashAmountReceived : total;
      const { data: orderId, error } = await supabase.rpc("complete_order", {
        p_items: cart.map(({ product, quantity, size }) => ({
          product_id: product.id,
          variant: size,
          quantity,
        })),
        p_discount_type: discountType,
        p_payment_method: paymentMethod,
        p_amount_received: paymentReceived,
      });
      if (error) throw error;
      if (typeof orderId !== "string") {
        throw new Error("Supabase returned an invalid order receipt ID.");
      }
      setReceipt({
        orderId,
        items: cart.map((item) => ({
          ...item,
          product: { ...item.product },
        })),
        subtotal,
        discountType,
        discountAmount,
        total,
        paymentMethod,
        amountReceived: paymentReceived,
        changeDue:
          paymentMethod === "cash"
            ? Math.round((paymentReceived - total + Number.EPSILON) * 100) /
              100
            : 0,
        completedAt: new Date(),
        storeName: settings.storeName,
        address: settings.address,
        phone: settings.phone,
        vatTin: settings.vatTin,
        receiptFooter: settings.receiptFooter,
      });
      setCart([]);
      setAmountReceived("");
      setPaymentMethod("cash");
      setDiscountType(null);
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
    window.location.replace(
      new URL("/login", window.location.href).toString(),
    );
  }

  async function punchAttendance(action: "clock_in" | "clock_out") {
    if (!/^[0-9]{6}$/.test(attendancePin)) {
      setAttendanceError("Enter the employee's six-digit attendance PIN.");
      return;
    }
    setIsPunchingAttendance(true);
    setAttendanceError("");
    setAttendanceMessage("");
    try {
      const { data, error } = await createSupabaseBrowserClient().rpc(
        "punch_attendance",
        { p_pin: attendancePin, p_action: action },
      );
      if (error) throw error;
      if (typeof data !== "object" || data === null || !("status" in data)) {
        throw new Error("The attendance response was invalid.");
      }
      const result = data as Record<string, unknown>;
      const employee =
        typeof result.staff_email === "string" ? result.staff_email : "Employee";
      const retryAt =
        typeof result.retry_after === "string"
          ? new Date(result.retry_after).getTime()
          : Number.NaN;
      const retryMinutes = Number.isFinite(retryAt)
        ? Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000))
        : 10;
      const messages: Record<string, string> = {
        clocked_in: `${employee} is clocked in.`,
        clocked_out: `${employee} is clocked out.`,
        already_clocked_in: `${employee} already has an open shift.`,
        not_clocked_in: `${employee} does not have an open shift to clock out.`,
        invalid_pin: `PIN not recognized. ${String(result.attempts_remaining ?? 0)} attempts remain before a 10-minute lockout.`,
        locked: `Attendance PIN entry is temporarily locked. Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
      };
      if (typeof result.status !== "string" || !messages[result.status]) {
        throw new Error("The attendance service returned an unknown result.");
      }
      if (result.status === "invalid_pin" || result.status === "locked") {
        setAttendanceError(messages[result.status]);
      } else {
        setAttendanceMessage(messages[result.status]);
      }
      setAttendancePin("");
    } catch (error) {
      setAttendanceError(`Could not record attendance: ${describeError(error)}`);
    } finally {
      setIsPunchingAttendance(false);
    }
  }

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <header className="border-b border-cafe-border bg-cafe-card shadow-[0_2px_12px_rgba(16,42,67,0.06)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cafe-espresso text-xl text-white shadow-sm">
              ☕
            </div>
            <div>
              <p className="font-semibold tracking-tight text-cafe-espresso">
                {settings.storeName}
              </p>
              <p className="text-xs text-cafe-muted">
                System by: Apatnatwo-gether
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {role !== "staff" && (
              <Link
                href="/dashboard"
                className="rounded-lg border border-cafe-border bg-cafe-surface-soft px-3 py-2 text-sm font-medium text-cafe-espresso transition hover:border-cafe-sage hover:bg-cafe-accent-soft"
              >
                Management
              </Link>
            )}
            <RegisterFinancialActivity role={role} />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{email}</p>
              <p className="text-xs capitalize text-cafe-muted">{role}</p>
            </div>
            <span className="rounded-full bg-cafe-surface-soft px-3 py-1.5 text-xs font-semibold capitalize text-cafe-espresso sm:hidden">
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

      <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-6 pb-28 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 lg:py-8 lg:pb-8">
        <section aria-labelledby="menu-heading">
          <div className="mb-6 rounded-3xl bg-gradient-to-br from-[#102a43] to-[#155e63] px-6 py-7 text-white shadow-[0_14px_32px_rgba(16,42,67,0.14)] sm:px-8 sm:py-9">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-[#b7e5de]">
              FRESHLY MADE, JUST FOR YOU
            </p>
            <h1
              id="menu-heading"
              className="text-3xl font-semibold tracking-tight text-white sm:text-4xl"
            >
              Your daily ritual.
            </h1>
            <p className="mt-2 text-sm text-[#d8e4e9]">
              What can we make for you today?
            </p>
            <button
              type="button"
              onClick={() => {
                setAttendanceOpen(true);
                setAttendancePin("");
                setAttendanceError("");
                setAttendanceMessage("");
              }}
              className="mt-5 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Staff clock in / out
            </button>
          </div>

          <label className="mb-5 flex h-12 max-w-xl items-center gap-3 rounded-xl border border-cafe-border bg-cafe-card px-4 text-cafe-muted shadow-[0_2px_10px_rgba(74,52,40,0.03)] focus-within:border-cafe-sage">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search the menu</span>
            <input
              aria-label="Search menu items"
              className="h-full w-full bg-transparent text-sm text-[#342a22] outline-none placeholder:text-[#a39789]"
              placeholder="Search coffee, tea, bakery..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-cafe-sage-dark hover:bg-[#f3f4ed]"
              >
                Clear
              </button>
            )}
          </label>

          <div
            aria-label="Menu categories"
            className="mb-4 flex gap-2 overflow-x-auto pb-1"
          >
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={activeCategory === category}
                onClick={() => setActiveCategory(category)}
                className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeCategory === category
                    ? "bg-cafe-sage-dark text-white shadow-sm"
                    : "border border-cafe-border bg-cafe-card text-cafe-muted hover:bg-cafe-surface-soft"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
          {!isLoadingMenu && !menuError && (
            <p className="mb-4 text-xs text-cafe-muted" aria-live="polite">
              Showing {visibleProducts.length} of {products.length} menu{" "}
              {products.length === 1 ? "item" : "items"}
            </p>
          )}

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
              {visibleProducts.map((product) => {
                const regularAvailability = availability[`${product.id}:regular`];
                const largeAvailability = availability[`${product.id}:large`];
                const isUnavailable =
                  !regularAvailability?.available &&
                  (product.largePrice === null || !largeAvailability?.available);
                const unavailableIngredients = [
                  ...(regularAvailability?.unavailableIngredients ?? []),
                  ...(largeAvailability?.unavailableIngredients ?? []),
                ].filter((name, index, names) => names.indexOf(name) === index);
                return (
                <button
                  key={product.id}
                  type="button"
                  disabled={isUnavailable}
                  onClick={() =>
                    product.largePrice === null
                      ? regularAvailability?.available && addToCart(product)
                      : setSizeSelection(product)
                  }
                  className="group min-h-64 rounded-2xl border border-cafe-border bg-cafe-card p-3 text-left shadow-[0_3px_14px_rgba(74,52,40,0.035)] transition hover:-translate-y-0.5 hover:border-[#bdc6b5] hover:shadow-[0_10px_24px_rgba(74,52,40,0.1)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <div
                    className={`flex h-32 items-center justify-center rounded-xl text-5xl ${productColors[product.color]}`}
                    aria-hidden="true"
                  >
                    {product.icon}
                  </div>
                  {isUnavailable && (
                    <span className="mt-2 inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800">
                      Unavailable{unavailableIngredients.length ? ` · ${unavailableIngredients.join(", ")} out of stock` : ""}
                    </span>
                  )}
                  {!isUnavailable && unavailableIngredients.length > 0 && (
                    <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
                      Some sizes unavailable
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-2 px-1 pb-1 pt-4">
                    <div>
                      <h2 className="font-semibold">{product.name}</h2>
                      <p className="mt-1 text-xs leading-5 text-cafe-muted">
                        {product.description}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-cafe-espresso">
                      {product.largePrice === null
                        ? formatCurrency(product.price)
                        : `${formatCurrency(product.price)} / ${formatCurrency(product.largePrice)}`}
                    </span>
                  </div>
                  <p className="px-1 pt-2 text-xs font-medium text-cafe-sage group-hover:text-cafe-sage-dark">
                    + Add to order
                  </p>
                </button>
                );
              })}
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
            <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-cafe-accent-soft px-2 text-sm font-semibold text-cafe-sage-dark">
              {itemCount}
            </span>
          </div>

          {cart.length === 0 ? (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-cafe-surface-soft text-2xl">
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
                      {formatCurrency(
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
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-cafe-border text-lg text-cafe-espresso transition hover:bg-cafe-surface-soft"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm">{quantity}</span>
                    <button
                      type="button"
                      aria-label={`Add one ${size} ${product.name}`}
                      onClick={() => changeQuantity(product.id, size, 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-cafe-border text-lg text-cafe-espresso transition hover:bg-cafe-surface-soft"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 border-t border-cafe-border pt-5">
            <p className="mb-3 text-sm font-medium">Eligible discount</p>
            <button
              type="button"
              aria-pressed={discountType === "pwd_senior"}
              onClick={() =>
                setDiscountType((current) =>
                  current === "pwd_senior" ? null : "pwd_senior",
                )
              }
              className={`min-h-11 w-full rounded-lg border px-3 text-sm font-medium ${
                discountType === "pwd_senior"
                  ? "border-cafe-sage-dark bg-cafe-sage-dark text-white"
                  : "border-cafe-border bg-white text-cafe-espresso"
              }`}
            >
              PWD / Senior Citizen · 10%
            </button>
            {discountType && (
              <p className="mt-2 text-xs text-cafe-muted">
                10% discount: {formatCurrency(discountAmount)}
              </p>
            )}
          </div>

          <div className="space-y-3 border-t border-cafe-border pt-5 text-sm">
            <div className="flex justify-between text-cafe-muted">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {discountType && (
              <div className="flex justify-between text-cafe-sage-dark">
                <span>{discountLabel} discount (10%)</span>
                <span>−{formatCurrency(discountAmount)}</span>
              </div>
            )}
            {discountType && (
              <div className="flex justify-between text-cafe-muted">
                <span>Discounted subtotal</span>
                <span>{formatCurrency(discountedSubtotal)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-base font-semibold">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="mt-5 space-y-4 border-t border-cafe-border pt-5">
            <div>
              <label
                htmlFor="payment-method"
                className="mb-2 block text-sm font-medium"
              >
                Payment method <span aria-hidden="true">*</span>
              </label>
              <select
                id="payment-method"
                required
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(event.target.value as PaymentMethod)
                }
                className="h-11 w-full rounded-lg border border-cafe-border bg-white px-3 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="e_wallet">E-wallet</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="amount-received"
                className="mb-2 block text-sm font-medium"
              >
                Amount received <span aria-hidden="true">*</span>
              </label>
              {paymentMethod === "cash" ? (
                <input
                  id="amount-received"
                  type="number"
                  inputMode="decimal"
                  required
                  min={total.toFixed(2)}
                  step="0.01"
                  value={amountReceived}
                  onChange={(event) => setAmountReceived(event.target.value)}
                  placeholder={total.toFixed(2)}
                  className="h-11 w-full rounded-lg border border-cafe-border bg-white px-3 text-sm"
                />
              ) : (
                <input
                  id="amount-received"
                  type="text"
                  readOnly
                  value={formatCurrency(total)}
                  className="h-11 w-full rounded-lg border border-cafe-border bg-[#f3eee5] px-3 text-sm"
                />
              )}
              {paymentMethod === "cash" && isPaymentValid && cart.length > 0 && (
                <p className="mt-2 text-sm text-cafe-muted">
                  Change due:{" "}
                  {formatCurrency(
                    Math.round(
                      (cashAmountReceived - total + Number.EPSILON) * 100,
                    ) / 100,
                  )}
                </p>
              )}
            </div>
          </div>

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
            disabled={isCheckoutDisabled}
            onClick={placeOrder}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-cafe-sage-dark px-4 font-medium text-white transition hover:bg-[#43563d] disabled:cursor-not-allowed disabled:bg-[#b8beb5]"
          >
            {isLoadingSettings
              ? "Loading store settings..."
              : isSavingOrder
              ? "Completing order..."
              : `Complete order · ${formatCurrency(total)}`}
          </button>
        </aside>
      </div>
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-cafe-border bg-cafe-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(74,52,40,0.12)] backdrop-blur lg:hidden">
          <button
            type="button"
            disabled={isCheckoutDisabled}
            onClick={() => void placeOrder()}
            className="flex h-12 w-full items-center justify-between rounded-xl bg-cafe-sage-dark px-4 font-semibold text-white transition hover:bg-[#43563d] disabled:cursor-not-allowed disabled:bg-[#b8beb5]"
          >
            <span>
              {isSavingOrder
                ? "Completing order..."
                : `Checkout · ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
            </span>
            <span>{formatCurrency(total)}</span>
          </button>
        </div>
      )}
      {receipt && (
        <div className="receipt-overlay fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-[#241b15]/60 px-4 py-8">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-title"
            className="receipt-print w-full max-w-md rounded-2xl bg-white p-6 text-[#28251f] shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3 print:hidden">
              <div>
                <h2 id="receipt-title" className="text-xl font-semibold">
                  Order receipt
                </h2>
                <p className="mt-1 text-sm text-cafe-muted">
                  Order completed successfully.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close receipt"
                onClick={() => setReceipt(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-cafe-border text-lg"
              >
                ×
              </button>
            </div>
            <div className="receipt-content">
              <header className="border-b border-dashed border-[#bdb6aa] pb-4 text-center">
                <h3 className="text-lg font-bold tracking-wide">
                  {receipt.storeName}
                </h3>
                <p className="mt-1 text-sm">Sales Invoice</p>
                {receipt.address && <p className="mt-1 text-xs">{receipt.address}</p>}
                {receipt.phone && <p className="mt-1 text-xs">{receipt.phone}</p>}
                {receipt.vatTin && <p className="mt-1 text-xs">VAT REG TIN: {receipt.vatTin}</p>}
                <p className="mt-2 break-all text-xs">
                  Order: {receipt.orderId}
                </p>
                <p className="mt-1 text-xs">
                  {receipt.completedAt.toLocaleString()}
                </p>
              </header>
              <ul className="space-y-3 border-b border-dashed border-[#bdb6aa] py-4 text-sm">
                {receipt.items.map(({ product, quantity, size }) => {
                  const unitPrice =
                    size === "large"
                      ? (product.largePrice ?? product.price)
                      : product.price;
                  return (
                    <li
                      key={`${product.id}-${size}`}
                      className="flex justify-between gap-4"
                    >
                      <span>
                        {quantity} × {product.name} ({size})
                      </span>
                      <span className="whitespace-nowrap">
                        {formatCurrency(unitPrice * quantity)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <dl className="space-y-2 py-4 text-sm">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd>{formatCurrency(receipt.subtotal)}</dd>
                </div>
                {receipt.discountType && (
                  <div className="flex justify-between">
                    <dt>{discountLabel} discount (10%)</dt>
                    <dd>−{formatCurrency(receipt.discountAmount)}</dd>
                  </div>
                )}
                {receipt.discountType && (
                  <div className="flex justify-between">
                    <dt>Discounted subtotal</dt>
                    <dd>
                      {formatCurrency(receipt.subtotal - receipt.discountAmount)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-[#bdb6aa] pt-3 text-base font-bold">
                  <dt>Total</dt>
                  <dd>{formatCurrency(receipt.total)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Payment method</dt>
                  <dd>{paymentMethodLabels[receipt.paymentMethod]}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Amount received</dt>
                  <dd>{formatCurrency(receipt.amountReceived)}</dd>
                </div>
                {receipt.paymentMethod === "cash" && (
                  <div className="flex justify-between font-semibold">
                    <dt>Change</dt>
                    <dd>{formatCurrency(receipt.changeDue)}</dd>
                  </div>
                )}
              </dl>
              <p className="border-t border-dashed border-[#bdb6aa] pt-4 text-center text-xs">
                {receipt.receiptFooter}
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
                onClick={() => setReceipt(null)}
                className="h-11 rounded-xl border border-cafe-border px-4 font-medium"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}
      {attendanceOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#241b15]/50 px-5 py-8"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPunchingAttendance) {
              setAttendanceOpen(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-title"
            className="w-full max-w-md rounded-2xl border border-cafe-border bg-cafe-card p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 id="attendance-title" className="text-xl font-semibold text-cafe-espresso">
                  Staff clock in / out
                </h2>
                <p className="mt-1 text-sm text-cafe-muted">
                  Enter your attendance PIN. This will not change the signed-in cashier.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close attendance"
                disabled={isPunchingAttendance}
                onClick={() => setAttendanceOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-cafe-border hover:bg-[#eee5d7] disabled:opacity-50"
              >
                ×
              </button>
            </div>
            {attendanceError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{attendanceError}</p>}
            {attendanceMessage && <p role="status" className="mb-4 rounded-lg bg-[#edf1e8] px-3 py-2 text-sm text-cafe-sage-dark">{attendanceMessage}</p>}
            <label htmlFor="attendance-pin" className="mb-1.5 block text-sm font-medium">Six-digit PIN</label>
            <input
              id="attendance-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={attendancePin}
              onChange={(event) => setAttendancePin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter") void punchAttendance("clock_in");
              }}
              className="h-12 w-full rounded-lg border border-cafe-border bg-white px-4 text-center text-xl tracking-[0.45em]"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isPunchingAttendance || attendancePin.length !== 6}
                onClick={() => void punchAttendance("clock_in")}
                className="h-11 rounded-xl bg-cafe-sage-dark px-4 text-sm font-semibold text-white hover:bg-[#43563d] disabled:opacity-50"
              >
                {isPunchingAttendance ? "Recording..." : "Clock in"}
              </button>
              <button
                type="button"
                disabled={isPunchingAttendance || attendancePin.length !== 6}
                onClick={() => void punchAttendance("clock_out")}
                className="h-11 rounded-xl border border-cafe-border px-4 text-sm font-semibold hover:bg-cafe-surface-soft disabled:opacity-50"
              >
                Clock out
              </button>
            </div>
            <p className="mt-4 text-xs leading-5 text-cafe-muted">
              PINs are for attendance only. After five incorrect attempts on this signed-in POS account, entry is locked for 10 minutes.
            </p>
          </section>
        </div>
      )}
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
                disabled={!availability[`${sizeSelection.id}:regular`]?.available}
                onClick={() => {
                  addToCart(sizeSelection, "regular");
                  setSizeSelection(null);
                }}
                className="flex items-center justify-between rounded-xl border border-cafe-border px-4 py-4 text-left transition hover:border-cafe-sage hover:bg-[#f3f4ed] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="font-medium">
                  Regular
                  {!availability[`${sizeSelection.id}:regular`]?.available &&
                    ` · Unavailable${availability[`${sizeSelection.id}:regular`]?.unavailableIngredients.length ? ` — ${availability[`${sizeSelection.id}:regular`]?.unavailableIngredients.join(", ")} out of stock` : ""}`}
                </span>
                <span className="font-semibold text-cafe-espresso">
                  {formatCurrency(sizeSelection.price)}
                </span>
              </button>
              {sizeSelection.largePrice !== null && (
                <button
                  type="button"
                  disabled={!availability[`${sizeSelection.id}:large`]?.available}
                  onClick={() => {
                    addToCart(sizeSelection, "large");
                    setSizeSelection(null);
                  }}
                  className="flex items-center justify-between rounded-xl border border-cafe-border px-4 py-4 text-left transition hover:border-cafe-sage hover:bg-[#f3f4ed] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="font-medium">
                    Large
                    {!availability[`${sizeSelection.id}:large`]?.available &&
                      ` · Unavailable${availability[`${sizeSelection.id}:large`]?.unavailableIngredients.length ? ` — ${availability[`${sizeSelection.id}:large`]?.unavailableIngredients.join(", ")} out of stock` : ""}`}
                  </span>
                  <span className="font-semibold text-cafe-espresso">
                    {formatCurrency(sizeSelection.largePrice)}
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
