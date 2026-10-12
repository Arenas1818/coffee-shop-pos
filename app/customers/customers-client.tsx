"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import ManagementSidebar from "../management-sidebar";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
};

const blankForm = { name: "", email: "", phone: "", notes: "" };

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

export default function CustomersClient({
  role,
}: {
  role: "manager" | "admin";
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const loadCustomers = useCallback(async () => {
    const { data, error } = await createSupabaseBrowserClient()
      .from("customers")
      .select("id, name, email, phone, notes, active")
      .order("name");
    if (error) throw error;
    setCustomers((data ?? []) as Customer[]);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        await loadCustomers();
      } catch (error) {
        if (active) setErrorMessage(`Could not load customers: ${errorText(error)}`);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [loadCustomers]);

  function editCustomer(customer: Customer) {
    setEditingId(customer.id);
    setForm({
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      notes: customer.notes ?? "",
    });
    setNotice("");
    setErrorMessage("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(blankForm);
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setErrorMessage("Enter the customer's name.");
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const supabase = createSupabaseBrowserClient();
      const customerData = {
        name,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const result = editingId
        ? await supabase.from("customers").update(customerData).eq("id", editingId)
        : await supabase.from("customers").insert(customerData);
      if (result.error) throw result.error;
      await loadCustomers();
      setNotice(editingId ? "Customer updated." : "Customer added.");
      resetForm();
    } catch (error) {
      setErrorMessage(`Could not save customer: ${errorText(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleActive(customer: Customer) {
    setBusyId(customer.id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient()
        .from("customers")
        .update({ active: !customer.active, updated_at: new Date().toISOString() })
        .eq("id", customer.id);
      if (error) throw error;
      await loadCustomers();
      setNotice(customer.active ? "Customer archived." : "Customer restored.");
    } catch (error) {
      setErrorMessage(`Could not update customer: ${errorText(error)}`);
    } finally {
      setBusyId("");
    }
  }

  const filteredCustomers = customers.filter((customer) => {
    const query = search.trim().toLowerCase();
    return (
      !query ||
      customer.name.toLowerCase().includes(query) ||
      customer.email?.toLowerCase().includes(query) ||
      customer.phone?.toLowerCase().includes(query)
    );
  });

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:min-h-screen lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <ManagementSidebar role={role} />
        <div className="min-w-0 flex-1 px-0 py-2 lg:px-8 lg:py-8">
          <header className="mb-7">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">KAPE NA NAMAN</p>
            <h1 className="text-3xl font-semibold tracking-tight text-cafe-espresso">Customers</h1>
            <p className="mt-2 text-sm text-cafe-muted">Keep customer contact details and notes in one place.</p>
          </header>

          {errorMessage && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</p>}
          {notice && <p role="status" className="mb-5 rounded-xl bg-[#edf1e8] px-4 py-3 text-sm text-cafe-sage-dark">{notice}</p>}

          <section className="mb-7 rounded-2xl border border-cafe-border bg-cafe-card p-5 sm:p-7">
            <h2 className="text-lg font-semibold text-cafe-espresso">{editingId ? "Edit customer" : "Add customer"}</h2>
            <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={saveCustomer}>
              <div>
                <label htmlFor="customer-name" className="mb-1.5 block text-sm font-medium">Name</label>
                <input id="customer-name" required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="customer-phone" className="mb-1.5 block text-sm font-medium">Phone</label>
                <input id="customer-phone" type="tel" maxLength={40} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="customer-email" className="mb-1.5 block text-sm font-medium">Email</label>
                <input id="customer-email" type="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="customer-notes" className="mb-1.5 block text-sm font-medium">Notes</label>
                <input id="customer-notes" maxLength={500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm" />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={isSaving} className="h-11 rounded-xl bg-cafe-sage-dark px-5 text-sm font-medium text-white hover:bg-[#43563d] disabled:opacity-60">{isSaving ? "Saving..." : editingId ? "Save changes" : "Add customer"}</button>
                {editingId && <button type="button" onClick={resetForm} className="h-11 rounded-xl border border-cafe-border px-4 text-sm font-medium hover:bg-[#f3eee5]">Cancel</button>}
              </div>
            </form>
          </section>

          <section aria-labelledby="customer-list-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="customer-list-heading" className="text-lg font-semibold text-cafe-espresso">Customer list <span className="text-sm font-normal text-cafe-muted">({customers.length})</span></h2>
              <label className="sr-only" htmlFor="customer-search">Search customers</label>
              <input id="customer-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" className="h-10 rounded-lg border border-cafe-border bg-cafe-card px-3 text-sm" />
            </div>
            {isLoading ? <p role="status" className="rounded-xl bg-cafe-card p-6 text-sm text-cafe-muted">Loading customers...</p> : filteredCustomers.length === 0 ? <p className="rounded-xl bg-cafe-card p-6 text-sm text-cafe-muted">No customers match your search.</p> : (
              <ul className="divide-y divide-cafe-border rounded-2xl border border-cafe-border bg-cafe-card px-5">
                {filteredCustomers.map((customer) => (
                  <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="font-medium">{customer.name}{!customer.active && <span className="ml-2 text-xs font-normal text-cafe-muted">Archived</span>}</p>
                      <p className="mt-1 text-sm text-cafe-muted">{[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact details"}</p>
                      {customer.notes && <p className="mt-1 text-xs text-cafe-muted">{customer.notes}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => editCustomer(customer)} className="rounded-lg border border-cafe-border px-3 py-2 text-sm font-medium hover:bg-[#f3eee5]">Edit</button>
                      <button type="button" disabled={busyId === customer.id} onClick={() => void toggleActive(customer)} className="rounded-lg border border-cafe-border px-3 py-2 text-sm font-medium hover:bg-[#f3eee5] disabled:opacity-60">{customer.active ? "Archive" : "Restore"}</button>
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
