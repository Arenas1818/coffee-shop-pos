import type { SupabaseClient, User } from "@supabase/supabase-js";

export function isStaleAuthSessionError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return false;
  }

  return [
    "refresh_token_not_found",
    "refresh_token_already_used",
    "session_expired",
  ].includes(error.code);
}

export async function getUserOrNull(
  supabase: SupabaseClient,
): Promise<User | null> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      if (isStaleAuthSessionError(error)) return null;
      throw error;
    }
    return user;
  } catch (error) {
    if (
      (error instanceof Error && error.name === "AuthSessionMissingError") ||
      isStaleAuthSessionError(error)
    ) {
      return null;
    }
    throw error;
  }
}
