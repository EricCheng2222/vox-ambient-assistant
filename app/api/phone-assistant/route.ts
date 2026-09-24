import { requireUser } from "@/lib/auth";
import {
  deletePhoneAssistantSettings,
  getPhoneAssistantDestination,
  getPhoneAssistantSettings,
  isValidSpokenPassphrase,
  normalizePhoneNumber,
  savePhoneAssistantSettings,
  updatePhoneAssistantOptions,
} from "@/lib/phone-assistant-store";
import { getTwilioConfig, placeTwilioCall } from "@/lib/twilio";

const noStore = { "Cache-Control": "no-store" };

function requirePhoneOwner(auth: Awaited<ReturnType<typeof requireUser>>) {
  if ("response" in auth) return auth.response;
  if (auth.user.role !== "master" || auth.user.id !== "owner") {
    return Response.json(
      { error: "Phone access is available only to the Vox owner account." },
      { status: 403, headers: noStore },
    );
  }
  return null;
}

function publicStatus(
  settings: Awaited<ReturnType<typeof getPhoneAssistantSettings>>,
) {
  const twilio = getTwilioConfig();
  return {
    serviceConfigured: Boolean(twilio),
    configured: Boolean(settings),
    passphraseLength: settings?.passphraseLength ?? 0,
    callbackPhoneLabel: settings?.phoneLastFour
      ? `•••• ${settings.phoneLastFour}`
      : null,
    enabled: settings?.enabled ?? false,
    allowOutbound: settings?.allowOutbound ?? false,
    inboundNumber: twilio?.phoneNumber ?? null,
  };
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  const denied = requirePhoneOwner(auth);
  if (denied) return denied;
  if ("response" in auth) return auth.response;
  return Response.json(
    publicStatus(await getPhoneAssistantSettings(auth.user.id)),
    { headers: noStore },
  );
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  const denied = requirePhoneOwner(auth);
  if (denied) return denied;
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    callbackPhoneNumber?: string;
    passphrase?: string;
  } | null;
  if (!body) return Response.json({ error: "A phone request is required." }, { status: 400 });

  if (body.action === "configure") {
    const callbackPhoneNumber = body.callbackPhoneNumber?.trim() ?? "";
    const passphrase = body.passphrase?.trim() ?? "";
    if (
      !isValidSpokenPassphrase(passphrase) ||
      (callbackPhoneNumber && !normalizePhoneNumber(callbackPhoneNumber))
    ) {
      return Response.json(
        {
          error:
            "Use a private sentence of at least twelve characters. A callback number, if supplied, must use international format.",
        },
        { status: 400, headers: noStore },
      );
    }
    try {
      const settings = await savePhoneAssistantSettings(
        auth.user.id,
        passphrase,
        callbackPhoneNumber || null,
      );
      return Response.json(publicStatus(settings), { headers: noStore });
    } catch (error) {
      console.error("Phone assistant setup failed", error);
      return Response.json(
        { error: "That private sentence is unavailable. Choose a less common one." },
        { status: 409, headers: noStore },
      );
    }
  }

  if (body.action === "test_call") {
    const destination = await getPhoneAssistantDestination(auth.user.id);
    if (!destination) {
      return Response.json(
        { error: "Enable calls from Vox before requesting a test call." },
        { status: 400, headers: noStore },
      );
    }
    try {
      const call = await placeTwilioCall(
        destination,
        "你好，我是 Vox。這是一通由你剛剛親自要求的測試電話。電話助理已經連線完成。",
      );
      return Response.json({ call }, { headers: noStore });
    } catch (error) {
      console.error("Twilio test call failed", error);
      return Response.json(
        { error: "Vox 目前無法撥出測試電話。" },
        { status: 502, headers: noStore },
      );
    }
  }

  return Response.json({ error: "That phone action is not supported." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  const denied = requirePhoneOwner(auth);
  if (denied) return denied;
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    enabled?: unknown;
    allowOutbound?: unknown;
  } | null;
  if (!body || (typeof body.enabled !== "boolean" && typeof body.allowOutbound !== "boolean")) {
    return Response.json({ error: "Choose a phone setting to update." }, { status: 400 });
  }
  const current = await getPhoneAssistantSettings(auth.user.id);
  if (!current) return Response.json({ error: "Connect a phone first." }, { status: 404 });
  if (body.allowOutbound === true && !current.phoneLastFour) {
    return Response.json(
      { error: "Add an optional callback number before enabling calls from Vox." },
      { status: 400, headers: noStore },
    );
  }
  const settings = await updatePhoneAssistantOptions(auth.user.id, {
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    allowOutbound:
      typeof body.allowOutbound === "boolean" ? body.allowOutbound : undefined,
  });
  return Response.json(publicStatus(settings), { headers: noStore });
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  const denied = requirePhoneOwner(auth);
  if (denied) return denied;
  if ("response" in auth) return auth.response;
  await deletePhoneAssistantSettings(auth.user.id);
  return Response.json(publicStatus(null), { headers: noStore });
}
