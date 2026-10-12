import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function getUserOrNull(
  supabase: SupabaseClient,
): Promise<User | null> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    return user;
  } catch (error) {
    if (error instanceof Error && error.name === "AuthSessionMissingError") {
      return null;
    }
    throw error;
  }
}
