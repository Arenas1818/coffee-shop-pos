"use client";

import { FormEvent, useEffect, useState } from "react";
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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState("");
  const [backgroundVideoError, setBackgroundVideoError] = useState("");

  useEffect(() => {
    let isCurrent = true;
    const loadBackgroundVideo = async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: path, error } = await supabase.rpc(
          "get_landing_video_path",
        );
        if (error) throw error;
        if (path === null) return;
        if (typeof path !== "string") {
          throw new Error("The landing video setting has an invalid value.");
        }
        const { data } = supabase.storage.from("store-media").getPublicUrl(path);
        if (isCurrent) setBackgroundVideoUrl(data.publicUrl);
      } catch (error) {
        if (isCurrent) setBackgroundVideoError(describeError(error));
      }
    };
    const timer = window.setTimeout(() => void loadBackgroundVideo(), 0);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, []);

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cafe-cream px-5 py-12 text-cafe-espresso">
      {backgroundVideoUrl && (
        <video
          aria-hidden="true"
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source
            src={backgroundVideoUrl}
            type={backgroundVideoUrl.toLowerCase().includes(".webm") ? "video/webm" : "video/mp4"}
          />
        </video>
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cafe-cream/75 backdrop-blur-[2px]"
      />
      <section className="relative z-10 w-full max-w-md rounded-2xl border border-cafe-border bg-white/95 p-7 shadow-[0_24px_70px_rgba(16,42,67,0.2)] backdrop-blur-sm sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cafe-sage-dark text-xl text-white">
            ☕
          </div>
          <div>
            <p className="font-semibold tracking-tight">KAPE NA NAMAN</p>
            <p className="text-xs text-cafe-muted">Staff point of sale</p>
          </div>
        </div>
        <h1         className="text-2xl font-semibold tracking-tight text-cafe-espresso">Staff sign in</h1>
        <p className="mt-2 text-sm leading-6 text-cafe-muted">
          Sign in with the staff account created for you by your Supabase
          project administrator.
        </p>

        <form className="mt-7 space-y-5" onSubmit={signIn}>
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-semibold"
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
              className="h-11 w-full rounded-lg border border-cafe-border bg-white px-3 text-sm outline-none focus:border-cafe-sage focus:ring-2 focus:ring-cafe-sage/20"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-semibold"
            >
              Password
            </label>
            <div className="flex h-11 overflow-hidden rounded-lg border border-cafe-border bg-white focus-within:border-cafe-sage focus-within:ring-2 focus-within:ring-cafe-sage/20">
              <input
                id="password"
                name="password"
                type={isPasswordVisible ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
              />
              <button
                type="button"
                aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                aria-pressed={isPasswordVisible}
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                className="px-3 text-xs font-semibold text-cafe-sage-dark hover:bg-cafe-accent-soft"
              >
                {isPasswordVisible ? "Hide" : "Show"}
              </button>
            </div>
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
            className="flex h-11 w-full items-center justify-center rounded-xl bg-cafe-sage-dark px-4 font-semibold text-white transition hover:bg-cafe-sage disabled:cursor-wait disabled:opacity-60"
          >
            {isSigningIn ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-cafe-muted">
          Accounts are managed by your project administrator.
        </p>
        {backgroundVideoError && (
          <p
            role="status"
            className="mt-3 text-center text-xs text-[#9a5143]"
          >
            Landing video unavailable: {backgroundVideoError}
            {" "}Apply migrations 20261013000900 and 20261013001000 in Supabase.
          </p>
        )}
      </section>
    </main>
  );
}
