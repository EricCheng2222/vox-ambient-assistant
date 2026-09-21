import { requireUser } from "@/lib/auth";
import { createInviteCode, getInviteStatus } from "@/lib/invite-store";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return Response.json(await getInviteStatus(auth.user), { headers: noStore });
  } catch {
    return Response.json(
      { error: "Invite codes are temporarily unavailable." },
      { status: 503, headers: noStore },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name : undefined;

  try {
    return Response.json(await createInviteCode(auth.user, name), {
      status: 201,
      headers: noStore,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_LIMIT_REACHED") {
      return Response.json(
        { error: "This account has already created its one share code." },
        { status: 409, headers: noStore },
      );
    }
    return Response.json(
      { error: "The share code could not be created." },
      { status: 503, headers: noStore },
    );
  }
}
