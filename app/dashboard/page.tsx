import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getUserOrNull } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import DashboardClient from "./dashboard-client";

async function ManagerDashboard() {
  await connection();
  const supabase = await createSupabaseServerClient();
  const user = await getUserOrNull(supabase);
  if (!user) redirect("/login");

  const { data: role, error } = await supabase.rpc("current_staff_role");
  if (error) throw error;
  if (role !== "manager" && role !== "admin") redirect("/access-denied");

  return <DashboardClient email={user.email ?? ""} role={role} />;
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-cafe-cream text-sm text-cafe-muted">
          Checking dashboard access...
        </main>
      }
    >
      <ManagerDashboard />
    </Suspense>
  );
}
