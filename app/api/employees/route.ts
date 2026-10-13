import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getUserOrNull } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    return null;
  }
  return name;
}

function emailSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return slug || "employee";
}

function generatedPassword(): string {
  return randomBytes(48).toString("base64url");
}

function isDuplicateEmail(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "email_exists" ||
    error.message?.toLowerCase().includes("already been registered") === true
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const actor = await getUserOrNull(supabase);
  if (!actor) {
    return NextResponse.json({ error: "Sign in to manage employees." }, { status: 401 });
  }

  const { data: actorRole, error: roleError } =
    await supabase.rpc("current_staff_role");
  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 500 });
  }
  if (actorRole !== "manager" && actorRole !== "admin") {
    return NextResponse.json({ error: "Manager or admin access is required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Employee details are required." }, { status: 400 });
  }
  const { fullName, role } = body as Record<string, unknown>;
  const name = normalizeName(fullName);
  if (!name) {
    return NextResponse.json(
      { error: "Enter a full name between 2 and 100 characters." },
      { status: 400 },
    );
  }
  if (
    role !== "staff" &&
    !(actorRole === "admin" && (role === "manager" || role === "admin"))
  ) {
    return NextResponse.json(
      { error: "Managers can add regular staff only; choose a valid role." },
      { status: 403 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "Employee account creation is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server and restart the app.",
      },
      { status: 500 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const base = emailSlug(name);
  let createdUserId: string | null = null;
  let createdEmail: string | null = null;
  let creationError: { code?: string; message?: string } | null = null;

  for (let suffix = 1; suffix <= 20; suffix += 1) {
    const email = `${base}${suffix === 1 ? "" : `.${suffix}`}@kpnnmn.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: generatedPassword(),
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (!error) {
      createdUserId = data.user.id;
      createdEmail = email;
      break;
    }
    creationError = error;
    if (!isDuplicateEmail(error)) {
      return NextResponse.json(
        { error: `Could not create the employee's Auth account: ${error.message}` },
        { status: 500 },
      );
    }
  }

  if (!createdUserId || !createdEmail) {
    return NextResponse.json(
      {
        error: creationError
          ? `Could not find an unused generated email after 20 attempts: ${creationError.message}`
          : "Could not find an unused generated email after 20 attempts.",
      },
      { status: 409 },
    );
  }

  const { error: staffError } = await supabase.rpc("save_staff_member", {
    p_user_id: createdUserId,
    p_role: role,
  });
  if (staffError) {
    const { error: cleanupError } =
      await admin.auth.admin.deleteUser(createdUserId);
    const cleanupMessage = cleanupError
      ? ` Cleanup also failed; remove the unused Auth user ${createdEmail} manually.`
      : "";
    return NextResponse.json(
      {
        error: `The Auth user was created, but POS access could not be saved: ${staffError.message}.${cleanupMessage}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ email: createdEmail }, { status: 201 });
}
