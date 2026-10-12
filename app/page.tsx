import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getUserOrNull } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import PosClient from "./pos-client";

async function AuthenticatedHome() {
  await connection();
  const supabase = await createSupabaseServerClient();
  const user = await getUserOrNull(supabase);
  if (!user) redirect("/login");

  const { data: role, error: roleError } = await supabase.rpc("current_staff_role");
  if (roleError) throw roleError;
  if (role !== "staff" && role !== "manager" && role !== "admin") {
    redirect("/access-denied");
  }

  return (
    <PosClient
      email={user.email ?? ""}
      role={role}
    />
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#f8f7f4] text-sm text-[#77736b]">
          Checking staff access...
        </main>
      }
    >
      <AuthenticatedHome />
    </Suspense>
  );
}
