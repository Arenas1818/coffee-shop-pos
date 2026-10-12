"use client";

import { useEffect, useState, type FormEvent } from "react";
import ManagementSidebar from "../management-sidebar";
import { useStoreSettings, type StoreSettings } from "@/lib/store-settings";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export default function SettingsClient({
  role,
  email,
}: {
  role: "manager" | "admin";
  email: string;
}) {
  const { settings, error: settingsError, refreshSettings, setSettings } =
    useStoreSettings();
  const [form, setForm] = useState<StoreSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const syncForm = window.setTimeout(() => setForm(settings), 0);
    return () => window.clearTimeout(syncForm);
  }, [settings]);

  function update<K extends keyof StoreSettings>(
    key: K,
    value: StoreSettings[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "update_store_settings",
        {
          p_store_name: form.storeName,
          p_address: form.address,
          p_phone: form.phone,
          p_receipt_footer: form.receiptFooter,
          p_tax_rate: form.taxRate,
          p_currency_symbol: form.currencySymbol,
          p_global_low_stock_threshold: form.globalLowStockThreshold,
          p_background_video_path: form.backgroundVideoPath,
          p_background_video_enabled: form.backgroundVideoEnabled,
        },
      );
      if (error) throw error;
      await refreshSettings();
      setSettings(form);
      setNotice("Store settings saved.");
    } catch (error) {
      setErrorMessage(
        typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
          ? error.message
          : String(error),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadAndApplyVideo() {
    if (!videoFile) {
      setErrorMessage("Choose an MP4 or WebM video file to upload.");
      return;
    }
    const extensionByType: Record<string, string> = {
      "video/mp4": "mp4",
      "video/webm": "webm",
    };
    const extension = extensionByType[videoFile.type];
    if (!extension || videoFile.size > 50 * 1024 * 1024) {
      setErrorMessage("Choose an MP4 or WebM video no larger than 50 MB.");
      return;
    }

    setIsUploadingVideo(true);
    setErrorMessage("");
    setNotice("");
    const supabase = createSupabaseBrowserClient();
    const newPath = `${crypto.randomUUID()}.${extension}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("store-media")
        .upload(newPath, videoFile, {
          cacheControl: "3600",
          contentType: videoFile.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: applyError } = await supabase.rpc(
        "apply_landing_video",
        { p_video_path: newPath },
      );
      if (applyError) {
        const { error: cleanupError } = await supabase.storage
          .from("store-media")
          .remove([newPath]);
        if (cleanupError) {
          throw new Error(
            `${applyError.message} The uploaded file could not be removed: ${cleanupError.message}`,
          );
        }
        throw applyError;
      }

      const oldPath = form.backgroundVideoPath;
      const updatedForm = {
        ...form,
        backgroundVideoPath: newPath,
        backgroundVideoEnabled: true,
      };
      setForm(updatedForm);
      setSettings(updatedForm);
      setVideoFile(null);
      await refreshSettings();
      if (oldPath && oldPath !== newPath) {
        const { error: removeError } = await supabase.storage
          .from("store-media")
          .remove([oldPath]);
        if (removeError) {
          setNotice(
            `Background video applied, but the previous video could not be removed: ${removeError.message}`,
          );
          return;
        }
      }
      setNotice("Background video uploaded and applied to the sign-in page.");
    } catch (error) {
      setErrorMessage(
        typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
          ? error.message
          : String(error),
      );
    } finally {
      setIsUploadingVideo(false);
    }
  }

  const fieldClass =
    "mt-1.5 h-11 w-full rounded-lg border border-cafe-border bg-white px-3 text-sm text-cafe-espresso";
  const labelClass =
    "block text-xs font-semibold uppercase tracking-[0.08em] text-cafe-muted";

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <header className="border-b border-cafe-border bg-cafe-card shadow-[0_2px_12px_rgba(74,52,40,0.04)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div>
            <p className="font-semibold tracking-tight text-cafe-espresso">
              {settings.storeName}
            </p>
            <p className="text-xs text-cafe-muted">Store configuration</p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium">{email}</p>
            <p className="text-xs capitalize text-cafe-muted">{role}</p>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <ManagementSidebar role={role} />
        <div className="min-w-0 flex-1 px-0 py-2 sm:py-4 lg:px-8 lg:py-8">
          <section className="mb-6 rounded-3xl bg-[#eee5d7] px-6 py-7 sm:px-8">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">
              MANAGEMENT WORKSPACE
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-cafe-espresso">
              Settings
            </h1>
            <p className="mt-2 text-sm text-[#75695d]">
              Configure store details, checkout tax, currency display, and
              inventory alerts.
            </p>
          </section>

          {(settingsError || errorMessage) && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {errorMessage || settingsError}
              {settingsError && (
                <p className="mt-1">
                  Apply migrations 20261013000900_store_settings.sql and
                  20261013001000_landing_background_video.sql in Supabase, in
                  order.
                </p>
              )}
            </div>
          )}
          {notice && (
            <p
              role="status"
              className="mb-5 rounded-xl bg-[#edf1e8] px-4 py-3 text-sm text-cafe-sage-dark"
            >
              {notice}
            </p>
          )}

          <form
            onSubmit={(event) => void saveSettings(event)}
            className="grid items-stretch gap-5 xl:grid-cols-2"
          >
            <section className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6">
              <h2 className="mb-5 text-lg font-semibold text-cafe-espresso">
                Store Information
              </h2>
              <div className="space-y-4">
                <label className={labelClass}>
                  Store name
                  <input
                    required
                    maxLength={100}
                    value={form.storeName}
                    onChange={(event) => update("storeName", event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  Address
                  <input
                    maxLength={250}
                    value={form.address}
                    onChange={(event) => update("address", event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  Phone
                  <input
                    type="tel"
                    maxLength={32}
                    value={form.phone}
                    onChange={(event) => update("phone", event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  Receipt footer message
                  <textarea
                    maxLength={200}
                    rows={3}
                    value={form.receiptFooter}
                    onChange={(event) =>
                      update("receiptFooter", event.target.value)
                    }
                    className="mt-1.5 w-full rounded-lg border border-cafe-border bg-white px-3 py-2 text-sm text-cafe-espresso"
                  />
                </label>
              </div>
            </section>

            <section className="flex flex-col rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6">
              <h2 className="mb-5 text-lg font-semibold text-cafe-espresso">
                Operations
              </h2>
              <div className="space-y-4">
                <label className={labelClass}>
                  Tax rate (%)
                  <input
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.taxRate}
                    onChange={(event) =>
                      update("taxRate", Number(event.target.value))
                    }
                    className={fieldClass}
                  />
                  <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-cafe-muted">
                    Applies to new orders, after any order discount.
                  </span>
                </label>
                <label className={labelClass}>
                  Currency symbol
                  <input
                    required
                    minLength={1}
                    maxLength={6}
                    value={form.currencySymbol}
                    onChange={(event) =>
                      update("currencySymbol", event.target.value)
                    }
                    className={fieldClass}
                  />
                </label>
                <label className={labelClass}>
                  Global low stock threshold
                  <input
                    type="number"
                    required
                    min="0"
                    max="999999999.999"
                    step="0.001"
                    value={form.globalLowStockThreshold}
                    onChange={(event) =>
                      update(
                        "globalLowStockThreshold",
                        Number(event.target.value),
                      )
                    }
                    className={fieldClass}
                  />
                  <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-cafe-muted">
                    Used when an individual supply has no custom alert
                    threshold.
                  </span>
                </label>
                <div className="rounded-xl border border-cafe-border bg-[#f8f4ec] p-4">
                  <h3 className="text-sm font-semibold text-cafe-espresso">
                    Landing background video
                  </h3>
                  <p className="mt-1 text-xs text-cafe-muted">
                    Upload an MP4 or WebM video (maximum 50 MB) to display
                    behind the staff sign-in page.
                  </p>
                  {form.backgroundVideoPath && (
                    <p className="mt-2 break-all text-xs text-cafe-sage-dark">
                      Current video: {form.backgroundVideoPath}
                    </p>
                  )}
                  <label className="mt-3 flex items-center gap-2 text-sm text-cafe-espresso">
                    <input
                      type="checkbox"
                      checked={form.backgroundVideoEnabled}
                      disabled={!form.backgroundVideoPath}
                      onChange={(event) =>
                        update("backgroundVideoEnabled", event.target.checked)
                      }
                      className="h-4 w-4 accent-[#506348]"
                    />
                    Enable background video on sign-in page
                  </label>
                  <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.08em] text-cafe-muted">
                    Video file
                    <input
                      type="file"
                      accept="video/mp4,video/webm,.mp4,.webm"
                      onChange={(event) =>
                        setVideoFile(event.target.files?.[0] ?? null)
                      }
                      className="mt-1.5 block w-full text-sm normal-case tracking-normal file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!videoFile || isUploadingVideo}
                    onClick={() => void uploadAndApplyVideo()}
                    className="mt-3 h-10 w-full rounded-lg border border-cafe-border bg-white px-4 text-sm font-medium text-cafe-espresso disabled:opacity-60"
                  >
                    {isUploadingVideo ? "Uploading and applying..." : "Upload & Apply"}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={isSaving || isUploadingVideo}
                className="mt-auto flex h-11 w-full items-center justify-center rounded-xl bg-cafe-sage-dark px-4 font-medium text-white disabled:opacity-60"
              >
                {isSaving ? "Saving settings..." : "Save Settings"}
              </button>
            </section>
          </form>
        </div>
      </div>
    </main>
  );
}
