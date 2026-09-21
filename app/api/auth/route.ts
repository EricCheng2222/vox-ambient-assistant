import {
  createSessionToken,
  expiredSessionCookie,
  getAuthorizedUser,
  isAuthConfigured,
  sessionCookie,
  verifyAccessCode,
} from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getAuthorizedUser(request);
  return Response.json(
    {
      authenticated: Boolean(user),
      configured: isAuthConfigured(),
      user: user ? { displayName: user.displayName } : undefined,
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

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = body.code?.trim().slice(0, 256) ?? "";
  const user = code ? await verifyAccessCode(code) : null;
  if (!user) {
    return Response.json({ error: "That access code is not valid." }, { status: 401 });
  }

  return Response.json(
    {
      authenticated: true,
      configured: true,
      user: { displayName: user.displayName },
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
