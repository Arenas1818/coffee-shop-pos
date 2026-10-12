"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase";

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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setErrorMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      router.replace("/");
      router.refresh();
    } catch (error) {
      setErrorMessage(describeError(error));
      setIsSigningIn(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f7f4] px-5 py-12 text-[#28251f]">
      <section className="w-full max-w-md rounded-2xl border border-[#e9e6e0] bg-white p-7 shadow-sm sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#344b3b] text-xl text-white">
            ☕
          </div>
          <div>
            <p className="font-semibold tracking-tight">KAPE NA NAMAN</p>
            <p className="text-xs text-[#88847b]">Staff point of sale</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff sign in</h1>
        <p className="mt-2 text-sm leading-6 text-[#77736b]">
          Sign in with the staff account created for you by your Supabase
          project administrator.
        </p>

        <form className="mt-7 space-y-5" onSubmit={signIn}>
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-lg border border-[#e2dfd8] bg-white px-3 text-sm outline-none focus:border-[#788f78] focus:ring-2 focus:ring-[#788f78]/20"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-lg border border-[#e2dfd8] bg-white px-3 text-sm outline-none focus:border-[#788f78] focus:ring-2 focus:ring-[#788f78]/20"
            />
          </div>
          {errorMessage && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              Sign-in failed: {errorMessage}
            </p>
          )}
          <button
            type="submit"
            disabled={isSigningIn}
            className="flex h-11 w-full items-center justify-center rounded-xl bg-[#344b3b] px-4 font-medium text-white transition hover:bg-[#283c2e] disabled:cursor-wait disabled:opacity-60"
          >
            {isSigningIn ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-[#9a968e]">
          Accounts are managed by your project administrator.
        </p>
      </section>
    </main>
  );
}
