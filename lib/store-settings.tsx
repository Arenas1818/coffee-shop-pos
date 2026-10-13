"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { isStaleAuthSessionError } from "@/lib/auth";

export type StoreInfoDetail = { label: string; value: string };
export type StoreInfoField =
  | "store_name"
  | "address"
  | "phone"
  | "vat_tin";

export type StoreSettings = {
  storeName: string;
  address: string;
  phone: string;
  vatTin: string;
  visibleStoreFields: StoreInfoField[];
  additionalDetails: StoreInfoDetail[];
  receiptFooter: string;
  currencySymbol: string;
  globalLowStockThreshold: number;
  backgroundVideoPath: string | null;
  backgroundVideoEnabled: boolean;
};

const defaultSettings: StoreSettings = {
  storeName: "KAPE NA NAMAN",
  address: "",
  phone: "",
  vatTin: "",
  visibleStoreFields: ["store_name", "address", "vat_tin"],
  additionalDetails: [],
  receiptFooter: "Thank you for your order!",
  currencySymbol: "₱",
  globalLowStockThreshold: 10,
  backgroundVideoPath: null,
  backgroundVideoEnabled: false,
};

type StoreSettingsContextValue = {
  settings: StoreSettings;
  isLoading: boolean;
  error: string;
  refreshSettings: () => Promise<void>;
  setSettings: (settings: StoreSettings) => void;
  formatCurrency: (amount: number) => string;
};

const StoreSettingsContext = createContext<StoreSettingsContextValue | null>(
  null,
);

function parseSettings(value: unknown): StoreSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Store settings returned an invalid response.");
  }
  const data = value as Record<string, unknown>;
  const globalLowStockThreshold = Number(data.global_low_stock_threshold);
  if (
    typeof data.store_name !== "string" ||
    typeof data.address !== "string" ||
    typeof data.phone !== "string" ||
    typeof data.vat_tin !== "string" ||
    !Array.isArray(data.visible_store_fields) ||
    !Array.isArray(data.additional_details) ||
    typeof data.receipt_footer !== "string" ||
    typeof data.currency_symbol !== "string" ||
    (data.background_video_path !== null &&
      typeof data.background_video_path !== "string") ||
    typeof data.background_video_enabled !== "boolean" ||
    !Number.isFinite(globalLowStockThreshold)
  ) {
    throw new Error("Store settings returned invalid values.");
  }
  const validStoreFields: StoreInfoField[] = [
    "store_name",
    "address",
    "phone",
    "vat_tin",
  ];
  if (
    !data.visible_store_fields.every(
      (field: unknown): field is StoreInfoField =>
        typeof field === "string" &&
        validStoreFields.includes(field as StoreInfoField),
    ) ||
    new Set(data.visible_store_fields).size !== data.visible_store_fields.length
  ) {
    throw new Error("Store settings returned invalid visible receipt fields.");
  }
  const additionalDetails: StoreInfoDetail[] = data.additional_details.map(
    (detail: unknown) => {
      if (
        typeof detail !== "object" ||
        detail === null ||
        Array.isArray(detail) ||
        !("label" in detail) ||
        typeof detail.label !== "string" ||
        !("value" in detail) ||
        typeof detail.value !== "string"
      ) {
        throw new Error("Store settings returned invalid receipt details.");
      }
      return { label: detail.label, value: detail.value };
    },
  );
  return {
    storeName: data.store_name,
    address: data.address,
    phone: data.phone,
    vatTin: data.vat_tin,
    visibleStoreFields: data.visible_store_fields,
    additionalDetails,
    receiptFooter: data.receipt_footer,
    currencySymbol: data.currency_symbol,
    globalLowStockThreshold,
    backgroundVideoPath:
      typeof data.background_video_path === "string"
        ? data.background_video_path
        : null,
    backgroundVideoEnabled: data.background_video_enabled,
  };
}

export function StoreSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshSettings = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        if (isStaleAuthSessionError(userError)) {
          setSettings(defaultSettings);
          setError("");
          return;
        }
        throw userError;
      }
      if (!userData.user) {
        setSettings(defaultSettings);
        setError("");
        return;
      }

      const { data, error: settingsError } = await supabase.rpc(
        "get_store_settings",
      );
      if (settingsError) throw settingsError;
      setSettings(parseSettings(data));
      setError("");
    } catch (loadError) {
      setError(
        typeof loadError === "object" &&
          loadError !== null &&
          "message" in loadError &&
          typeof loadError.message === "string"
          ? loadError.message
          : String(loadError),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshSettings();
    }, 0);
    const supabase = createSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => void refreshSettings(), 0);
    });
    return () => {
      window.clearTimeout(initialLoad);
      subscription.unsubscribe();
    };
  }, [refreshSettings]);

  const formatCurrency = useCallback(
    (amount: number) => {
      const formatted = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
      return `${settings.currencySymbol}${formatted}`;
    },
    [settings.currencySymbol],
  );

  const value = useMemo(
    () => ({
      settings,
      isLoading,
      error,
      refreshSettings,
      setSettings,
      formatCurrency,
    }),
    [settings, isLoading, error, refreshSettings, formatCurrency],
  );

  return (
    <StoreSettingsContext.Provider value={value}>
      {children}
    </StoreSettingsContext.Provider>
  );
}

export function useStoreSettings() {
  const value = useContext(StoreSettingsContext);
  if (!value) {
    throw new Error(
      "useStoreSettings must be used within StoreSettingsProvider.",
    );
  }
  return value;
}
