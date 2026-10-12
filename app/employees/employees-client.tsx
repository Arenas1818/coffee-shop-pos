"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import ManagementSidebar from "../management-sidebar";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type StaffRole = "staff" | "manager" | "admin";
type Employee = {
  user_id: string;
  email: string;
  role: StaffRole;
  created_at: string;
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

export default function EmployeesClient({
  role,
  currentUserId,
}: {
  role: "manager" | "admin";
  currentUserId: string;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userId, setUserId] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("staff");
  const [roleEdits, setRoleEdits] = useState<Record<string, StaffRole>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  const loadEmployees = useCallback(async () => {
    const { data, error } =
      await createSupabaseBrowserClient().rpc("list_staff_members");
    if (error) throw error;
    setEmployees((data ?? []) as Employee[]);
    setRoleEdits(
      Object.fromEntries(
        ((data ?? []) as Employee[]).map((employee) => [
          employee.user_id,
          employee.role,
        ]),
      ),
    );
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        await loadEmployees();
      } catch (error) {
        if (active) setErrorMessage(`Could not load employees: ${errorText(error)}`);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [loadEmployees]);

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = userId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      setErrorMessage("Enter a valid Supabase Auth user UUID.");
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "save_staff_member",
        { p_user_id: id, p_role: newRole },
      );
      if (error) throw error;
      await loadEmployees();
      setUserId("");
      setNewRole("staff");
      setNotice("Employee access saved.");
    } catch (error) {
      setErrorMessage(`Could not save employee: ${errorText(error)}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function updateRole(employee: Employee) {
    const updatedRole = roleEdits[employee.user_id] ?? employee.role;
    if (updatedRole === employee.role) return;
    setBusyId(employee.user_id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "save_staff_member",
        { p_user_id: employee.user_id, p_role: updatedRole },
      );
      if (error) throw error;
      await loadEmployees();
      setNotice(`Role updated for ${employee.email}.`);
    } catch (error) {
      setErrorMessage(`Could not update role: ${errorText(error)}`);
      setRoleEdits((current) => ({
        ...current,
        [employee.user_id]: employee.role,
      }));
    } finally {
      setBusyId("");
    }
  }

  async function removeEmployee(employee: Employee) {
    if (!window.confirm(`Remove POS access for ${employee.email}?`)) return;
    setBusyId(employee.user_id);
    setErrorMessage("");
    setNotice("");
    try {
      const { error } = await createSupabaseBrowserClient().rpc(
        "remove_staff_member",
        { p_user_id: employee.user_id },
      );
      if (error) throw error;
      await loadEmployees();
      setNotice(`POS access removed for ${employee.email}.`);
    } catch (error) {
      setErrorMessage(`Could not remove employee: ${errorText(error)}`);
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="min-h-screen bg-cafe-cream text-[#342a22]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 py-5 sm:px-8 lg:min-h-screen lg:flex-row lg:gap-0 lg:px-0 lg:py-0">
        <ManagementSidebar role={role} />
        <div className="min-w-0 flex-1 px-0 py-2 lg:px-8 lg:py-8">
          <header className="mb-7">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-cafe-sage-dark">KAPE NA NAMAN</p>
            <h1 className="text-3xl font-semibold tracking-tight text-cafe-espresso">Employees</h1>
            <p className="mt-2 text-sm text-cafe-muted">
              Manage who can use the POS and their access level.
            </p>
          </header>

          {errorMessage && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</p>}
          {notice && <p role="status" className="mb-5 rounded-xl bg-[#edf1e8] px-4 py-3 text-sm text-cafe-sage-dark">{notice}</p>}

          <section className="mb-7 rounded-2xl border border-cafe-border bg-cafe-card p-5 sm:p-7">
            <h2 className="text-lg font-semibold text-cafe-espresso">Add existing Supabase user</h2>
            <p className="mt-1 text-sm text-cafe-muted">
              First create the account in Supabase Authentication → Users, then add its user ID here.
            </p>
            <form className="mt-5 grid gap-4 sm:grid-cols-[minmax(220px,1fr)_180px_auto]" onSubmit={saveEmployee}>
              <div>
                <label htmlFor="employee-user-id" className="mb-1.5 block text-sm font-medium">Supabase Auth user ID</label>
                <input id="employee-user-id" required value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="UUID from Authentication → Users" className="h-11 w-full rounded-lg border border-cafe-border px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="employee-role" className="mb-1.5 block text-sm font-medium">Role</label>
                <select id="employee-role" value={newRole} onChange={(event) => setNewRole(event.target.value as StaffRole)} className="h-11 w-full rounded-lg border border-cafe-border bg-white px-3 text-sm">
                  <option value="staff">Staff</option>
                  {role === "admin" && <><option value="manager">Manager</option><option value="admin">Admin</option></>}
                </select>
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={isSaving} className="h-11 rounded-xl bg-cafe-sage-dark px-5 text-sm font-medium text-white hover:bg-[#43563d] disabled:opacity-60">{isSaving ? "Saving..." : "Add employee"}</button>
              </div>
            </form>
            {role === "manager" && <p className="mt-3 text-xs text-cafe-muted">Managers can add and remove regular Staff. Only Admins can assign Manager or Admin roles.</p>}
          </section>

          <section aria-labelledby="employee-list-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="employee-list-heading" className="text-lg font-semibold text-cafe-espresso">Staff access</h2>
              <span className="text-sm text-cafe-muted">{employees.length} accounts</span>
            </div>
            {isLoading ? <p role="status" className="rounded-xl bg-cafe-card p-6 text-sm text-cafe-muted">Loading employees...</p> : employees.length === 0 ? <p className="rounded-xl bg-cafe-card p-6 text-sm text-cafe-muted">No employees have access yet.</p> : (
              <ul className="divide-y divide-cafe-border rounded-2xl border border-cafe-border bg-cafe-card px-5">
                {employees.map((employee) => (
                  <li key={employee.user_id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{employee.email}{employee.user_id === currentUserId && <span className="ml-2 text-xs font-normal text-cafe-muted">You</span>}</p>
                      <p className="mt-1 text-xs capitalize text-cafe-muted">{employee.role}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {role === "admin" ? (
                        <>
                          <label className="sr-only" htmlFor={`role-${employee.user_id}`}>Role for {employee.email}</label>
                          <select id={`role-${employee.user_id}`} value={roleEdits[employee.user_id] ?? employee.role} onChange={(event) => setRoleEdits((current) => ({ ...current, [employee.user_id]: event.target.value as StaffRole }))} className="h-9 rounded-lg border border-cafe-border bg-white px-2 text-sm">
                            <option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Admin</option>
                          </select>
                          <button type="button" disabled={busyId === employee.user_id || (roleEdits[employee.user_id] ?? employee.role) === employee.role} onClick={() => void updateRole(employee)} className="rounded-lg border border-cafe-border px-3 py-2 text-sm font-medium hover:bg-[#f3eee5] disabled:opacity-50">{busyId === employee.user_id ? "Saving..." : "Save role"}</button>
                        </>
                      ) : <span className="rounded-full bg-[#eee5d7] px-3 py-1.5 text-xs font-medium capitalize text-cafe-espresso">{employee.role}</span>}
                      <button type="button" disabled={busyId === employee.user_id || employee.user_id === currentUserId} onClick={() => void removeEmployee(employee)} className="rounded-lg border border-[#ead2cc] px-3 py-2 text-sm font-medium text-[#8a493d] hover:bg-[#fff4f1] disabled:opacity-50">{busyId === employee.user_id ? "Saving..." : "Remove access"}</button>
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
