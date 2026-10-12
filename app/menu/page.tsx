import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getUserOrNull } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import MenuManagerClient from "./menu-manager-client";

async function ManagerMenu() {
  await connection();
  const supabase = await createSupabaseServerClient();
  const user = await getUserOrNull(supabase);
  if (!user) redirect("/login");

  const { data: canManageMenu, error } =
    await supabase.rpc("can_manage_menu");
  if (error) throw error;
  if (!canManageMenu) redirect("/access-denied");

  return <MenuManagerClient />;
}

export default function MenuPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#f8f7f4] text-sm text-[#77736b]">
          Checking management access...
        </main>
      }
    >
      <ManagerMenu />
    </Suspense>
  );
}
