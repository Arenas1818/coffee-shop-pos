"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import ManagementSidebar from "../management-sidebar";
import {
  useStoreSettings,
  type StoreInfoField,
  type StoreSettings,
} from "@/lib/store-settings";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export default function SettingsClient({
  role,
  email,
}: {
  role: "manager" | "admin";
  email: string;
}) {
  const storeFieldOptions: { key: StoreInfoField; label: string }[] = [
    { key: "store_name", label: "Store name" },
    { key: "address", label: "Address" },
    { key: "phone", label: "Phone" },
    { key: "vat_tin", label: "VAT REG TIN" },
  ];
  const { settings, error: settingsError, refreshSettings, setSettings } =
    useStoreSettings();
  const [form, setForm] = useState<StoreSettings>(settings);
  const [storeFieldToAdd, setStoreFieldToAdd] = useState<StoreInfoField | "">(
    "",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const videoPreviewUrlRef = useRef<string | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const syncForm = window.setTimeout(() => setForm(settings), 0);
    return () => window.clearTimeout(syncForm);
  }, [settings]);

  useEffect(
    () => () => {
      if (videoPreviewUrlRef.current) {
        URL.revokeObjectURL(videoPreviewUrlRef.current);
      }
    },
    [],
  );

  function selectVideoFile(file: File | null) {
    if (videoPreviewUrlRef.current) {
      URL.revokeObjectURL(videoPreviewUrlRef.current);
    }
    const previewUrl = file ? URL.createObjectURL(file) : "";
    videoPreviewUrlRef.current = previewUrl || null;
    setVideoPreviewUrl(previewUrl);
    setVideoFile(file);
  }

  function update<K extends keyof StoreSettings>(
    key: K,
    value: StoreSettings[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addStoreField() {
    if (
      !storeFieldToAdd ||
      form.visibleStoreFields.includes(storeFieldToAdd)
    ) {
      return;
    }
    update("visibleStoreFields", [
      ...form.visibleStoreFields,
      storeFieldToAdd,
    ]);
    setStoreFieldToAdd("");
  }

  function removeStoreField(field: StoreInfoField) {
    update(
      "visibleStoreFields",
      form.visibleStoreFields.filter((visibleField) => visibleField !== field),
    );
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filledDetails = form.additionalDetails.filter(
      (detail) => detail.label.trim() || detail.value.trim(),
    );
    if (
      filledDetails.some(
        (detail) =>
          !detail.label.trim() ||
          !detail.value.trim() ||
          detail.label.trim().length > 40 ||
          detail.value.trim().length > 120,
      )
    ) {
      setErrorMessage(
        "Complete each additional store detail with a label and value (up to 40 and 120 characters).",
      );
      return;
    }
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
          p_vat_tin: form.vatTin,
          p_additional_details: filledDetails.map((detail) => ({
            label: detail.label.trim(),
            value: detail.value.trim(),
          })),
          p_receipt_footer: form.receiptFooter,
          p_currency_symbol: form.currencySymbol,
          p_global_low_stock_threshold: form.globalLowStockThreshold,
          p_background_video_path: form.backgroundVideoPath,
          p_background_video_enabled: form.backgroundVideoEnabled,
          p_visible_store_fields: form.visibleStoreFields,
        },
      );
      if (error) throw error;
      const savedSettings = {
        ...form,
        additionalDetails: filledDetails.map((detail) => ({
          label: detail.label.trim(),
          value: detail.value.trim(),
        })),
      };
      await refreshSettings();
      setSettings(savedSettings);
      setForm(savedSettings);
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
      selectVideoFile(null);
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
      <header className="border-b border-cafe-border bg-cafe-card shadow-[0_2px_12px_rgba(16,42,67,0.06)]">
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
          <section className="mb-6 rounded-3xl bg-gradient-to-br from-[#102a43] to-[#155e63] px-6 py-7 text-white shadow-[0_14px_32px_rgba(16,42,67,0.14)] sm:px-8">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-[#b7e5de]">
              MANAGEMENT WORKSPACE
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Settings
            </h1>
            <p className="mt-2 text-sm text-[#d8e4e9]">
              Manage store identity, checkout defaults, inventory alerts, and
              the sign-in page.
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
                  Apply migrations 20261013000900_store_settings.sql,
                  20261013001000_landing_background_video.sql,
                  20261013001400_register_tax_tin_refund_pin_availability.sql,
                  20261014000100_store_info_details_and_20_percent_discount.sql,
                  and 20261014000200_removable_store_receipt_fields.sql in
                  Supabase, in order.
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
                Store information
              </h2>
              <p className="mb-5 text-sm text-cafe-muted">
                Choose which store details appear on Sales Invoices. Removing a
                field hides it without deleting its saved value.
              </p>
              <div className="space-y-4">
                {form.visibleStoreFields.map((field) => {
                  const label = storeFieldOptions.find(
                    (option) => option.key === field,
                  )?.label;
                  if (!label) return null;
                  return (
                    <div
                      key={field}
                      className="flex items-end gap-2"
                    >
                      <label className={`${labelClass} min-w-0 flex-1`}>
                        {label}
                        {field === "store_name" && (
                          <input
                            required
                            maxLength={100}
                            value={form.storeName}
                            onChange={(event) =>
                              update("storeName", event.target.value)
                            }
                            className={fieldClass}
                          />
                        )}
                        {field === "address" && (
                          <input
                            maxLength={250}
                            value={form.address}
                            onChange={(event) =>
                              update("address", event.target.value)
                            }
                            className={fieldClass}
                          />
                        )}
                        {field === "phone" && (
                          <input
                            type="tel"
                            maxLength={32}
                            value={form.phone}
                            onChange={(event) =>
                              update("phone", event.target.value)
                            }
                            className={fieldClass}
                          />
                        )}
                        {field === "vat_tin" && (
                          <input
                            maxLength={80}
                            value={form.vatTin}
                            onChange={(event) =>
                              update("vatTin", event.target.value)
                            }
                            className={fieldClass}
                            placeholder="VAT registration TIN"
                          />
                        )}
                      </label>
                      <button
                        type="button"
                        onClick={() => removeStoreField(field)}
                        className="mb-0.5 h-11 shrink-0 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-700 transition hover:bg-red-50"
                        aria-label={`Remove ${label} from Sales Invoices`}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Store detail field to add"
                    value={storeFieldToAdd}
                    onChange={(event) =>
                      setStoreFieldToAdd(
                        event.target.value as StoreInfoField | "",
                      )
                    }
                    className="h-10 min-w-0 flex-1 rounded-lg border border-cafe-border bg-white px-3 text-sm"
                  >
                    <option value="">Add a store detail field</option>
                    {storeFieldOptions
                      .filter(
                        (option) =>
                          !form.visibleStoreFields.includes(option.key),
                      )
                      .map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!storeFieldToAdd}
                    onClick={addStoreField}
                    className="h-10 rounded-lg border border-cafe-border px-3 text-sm font-semibold text-cafe-espresso transition hover:bg-cafe-surface-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add detail
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className={labelClass}>Additional receipt details</h3>
                    <button
                      type="button"
                      disabled={form.additionalDetails.length >= 10}
                      onClick={() =>
                        update("additionalDetails", [
                          ...form.additionalDetails,
                          { label: "", value: "" },
                        ])
                      }
                      className="rounded-lg border border-cafe-border px-3 py-2 text-xs font-semibold text-cafe-espresso transition hover:bg-cafe-surface-soft disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add field
                    </button>
                  </div>
                  {form.additionalDetails.length === 0 ? (
                    <p className="text-xs text-cafe-muted">
                      Add optional labeled details to print below your store information.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {form.additionalDetails.map((detail, index) => (
                        <div
                          key={index}
                          className="grid gap-2 rounded-xl border border-cafe-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
                        >
                          <label className={labelClass}>
                            Label
                            <input
                              maxLength={40}
                              value={detail.label}
                              onChange={(event) => {
                                const nextDetails = [...form.additionalDetails];
                                nextDetails[index] = {
                                  ...detail,
                                  label: event.target.value,
                                };
                                update("additionalDetails", nextDetails);
                              }}
                              className={fieldClass}
                              placeholder="e.g. Permit No."
                            />
                          </label>
                          <label className={labelClass}>
                            Value
                            <input
                              maxLength={120}
                              value={detail.value}
                              onChange={(event) => {
                                const nextDetails = [...form.additionalDetails];
                                nextDetails[index] = {
                                  ...detail,
                                  value: event.target.value,
                                };
                                update("additionalDetails", nextDetails);
                              }}
                              className={fieldClass}
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={`Remove ${detail.label || "additional"} store detail`}
                            onClick={() =>
                              update(
                                "additionalDetails",
                                form.additionalDetails.filter(
                                  (_, detailIndex) => detailIndex !== index,
                                ),
                              )
                            }
                            className="mt-1.5 h-11 self-end rounded-lg border border-red-200 px-3 text-sm font-medium text-red-700 transition hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
                Checkout &amp; inventory
              </h2>
              <p className="mb-5 text-sm text-cafe-muted">
                Currency and low-stock defaults used by the register.
              </p>
              <div className="space-y-4">
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
              </div>
              <button
                type="submit"
                disabled={isSaving || isUploadingVideo}
                className="mt-auto flex h-11 w-full items-center justify-center rounded-xl bg-cafe-sage-dark px-4 font-medium text-white disabled:opacity-60"
              >
                {isSaving ? "Saving settings..." : "Save Settings"}
              </button>
            </section>

            <section className="rounded-2xl border border-cafe-border bg-cafe-card p-5 shadow-[0_3px_14px_rgba(74,52,40,0.035)] sm:p-6 xl:col-span-2">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-cafe-espresso">
                  Sign-in page
                </h2>
                <p className="mt-1 text-sm text-cafe-muted">
                  Preview a muted looping background video before applying it
                  to the staff sign-in page.
                </p>
              </div>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="space-y-4">
                  <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-cafe-muted">
                    Video file
                    <input
                      type="file"
                      accept="video/mp4,video/webm,.mp4,.webm"
                      onChange={(event) =>
                        selectVideoFile(event.target.files?.[0] ?? null)
                      }
                      className="mt-1.5 block w-full text-sm normal-case tracking-normal file:mr-3 file:rounded-lg file:border-0 file:bg-[#f8f4ec] file:px-3 file:py-2 file:text-sm file:font-medium"
                    />
                    <span className="mt-1 block text-xs font-normal normal-case tracking-normal">
                      MP4 or WebM, up to 50 MB.
                    </span>
                  </label>
                  {form.backgroundVideoPath && (
                    <p className="break-all rounded-lg bg-[#f8f4ec] px-3 py-2 text-xs text-cafe-muted">
                      Applied video: {form.backgroundVideoPath}
                    </p>
                  )}
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-cafe-border px-3 text-sm text-cafe-espresso">
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
                  <button
                    type="button"
                    disabled={!videoFile || isUploadingVideo}
                    onClick={() => void uploadAndApplyVideo()}
                    className="h-11 w-full rounded-lg bg-cafe-sage-dark px-4 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {isUploadingVideo
                      ? "Uploading and applying..."
                      : "Upload & Apply"}
                  </button>
                </div>
                <div className="overflow-hidden rounded-xl border border-cafe-border bg-[#f8f4ec]">
                  {videoPreviewUrl ? (
                    <video
                      key={videoPreviewUrl}
                      aria-label="Preview of selected sign-in background video"
                      controls
                      muted
                      playsInline
                      className="aspect-video w-full bg-[#241b15] object-contain"
                    >
                      <source
                        src={videoPreviewUrl}
                        type={videoFile?.type || "video/mp4"}
                      />
                    </video>
                  ) : (
                    <div className="flex aspect-video items-center justify-center px-6 text-center text-sm text-cafe-muted">
                      Choose a video file to preview it here before uploading.
                    </div>
                  )}
                  <p className="px-4 py-3 text-xs text-cafe-muted">
                    The sign-in page applies its own soft overlay so the form
                    remains readable.
                  </p>
                </div>
              </div>
            </section>
          </form>
        </div>
      </div>
    </main>
  );
}
