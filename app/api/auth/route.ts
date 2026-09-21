import {
  createSessionToken,
  expiredSessionCookie,
  getAuthorizedUser,
  isAuthConfigured,
  sessionCookie,
  verifyAccessCode,
} from "@/lib/auth";
import { bindUserEmail, isValidEmail } from "@/lib/contact-store";

export async function GET(request: Request) {
  const user = await getAuthorizedUser(request);
  return Response.json(
    {
      authenticated: Boolean(user),
      configured: isAuthConfigured(),
      user: user ? { displayName: user.displayName, role: user.role } : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      return Response.json({ authenticated: true, configured: false });
    }
    return Response.json(
      { error: "Vox access control has not been configured." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    email?: string;
  };
  const code = body.code?.trim().slice(0, 256) ?? "";
  const email = body.email?.trim().slice(0, 254) ?? "";
  if (!isValidEmail(email)) {
    return Response.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }
  const user = code ? await verifyAccessCode(code) : null;
  if (!user) {
    return Response.json({ error: "That access code is not valid." }, { status: 401 });
  }

  let emailStatus: Awaited<ReturnType<typeof bindUserEmail>>;
  try {
    emailStatus = await bindUserEmail(user.id, email);
  } catch {
    return Response.json(
      { error: "Vox could not securely save your email right now." },
      { status: 503 },
    );
  }
  if (emailStatus === "mismatch") {
    return Response.json(
      { error: "That email does not match this activation code." },
      { status: 401 },
    );
  }

  return Response.json(
    {
      authenticated: true,
      configured: true,
      user: { displayName: user.displayName, role: user.role },
    },
    { headers: { "Set-Cookie": sessionCookie(await createSessionToken(user.id)) } },
  );
}

export async function DELETE() {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": expiredSessionCookie() } },
  );
}
