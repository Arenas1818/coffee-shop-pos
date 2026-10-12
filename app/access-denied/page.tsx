"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export default function AccessDeniedPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    setErrorMessage("");
    const { error } = await createSupabaseBrowserClient().auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      setIsSigningOut(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f7f4] px-5 py-12 text-[#28251f]">
      <section className="w-full max-w-md rounded-2xl border border-[#e9e6e0] bg-white p-7 text-center shadow-sm sm:p-9">
        <h1 className="text-2xl font-semibold tracking-tight">
          You don&apos;t have access to this page
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#77736b]">
          KAPE NA NAMAN management pages are limited to users with the Manager
          or Admin role. Staff can still use the point of sale. Ask your project
          administrator if you need management access.
        </p>
        {errorMessage && (
          <p role="alert" className="mt-4 text-sm text-red-800">
            Could not sign out: {errorMessage}
          </p>
        )}
        <button
          type="button"
          disabled={isSigningOut}
          onClick={signOut}
          className="mt-6 h-11 rounded-xl bg-[#344b3b] px-5 font-medium text-white transition hover:bg-[#283c2e] disabled:cursor-wait disabled:opacity-60"
        >
          {isSigningOut ? "Signing out..." : "Sign out"}
        </button>
        <p className="mt-4">
          <Link
            href="/"
            className="text-sm font-medium text-[#536a55] hover:underline"
          >
            Return to the point of sale
          </Link>
        </p>
      </section>
    </main>
  );
}
