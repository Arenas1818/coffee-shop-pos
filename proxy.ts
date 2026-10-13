import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getUserOrNull } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart the dev server.",
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const user = await getUserOrNull(supabase);

  const isLoginPage = request.nextUrl.pathname === "/login";
  const isAccessDeniedPage = request.nextUrl.pathname === "/access-denied";
  const isManagementPage = [
    "/dashboard",
    "/menu",
    "/inventory",
    "/customers",
    "/employees",
    "/attendance",
  ].some(
    (path) =>
      request.nextUrl.pathname === path ||
      request.nextUrl.pathname.startsWith(`${path}/`),
  );
  if (!user && !isLoginPage) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (!user) return response;

  const { data: isStaff, error: staffError } = await supabase.rpc("is_staff");
  if (staffError) throw staffError;

  if (!isStaff) {
    if (!isAccessDeniedPage) {
      return NextResponse.redirect(new URL("/access-denied", request.url));
    }
    return response;
  }

  const { data: staffRole, error: staffRoleError } =
    await supabase.rpc("current_staff_role");
  if (staffRoleError) throw staffRoleError;

  if (isManagementPage) {
    if (staffRole !== "manager" && staffRole !== "admin") {
      return NextResponse.redirect(new URL("/access-denied", request.url));
    }
  }

  if (isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (
    isAccessDeniedPage &&
    (staffRole === "manager" || staffRole === "admin")
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
