import { env } from "cloudflare:workers";
import OpenAI from "openai";

import { getUserPreferences } from "@/lib/preference-store";
import {
  beginPhoneCall,
  endPhoneCall,
} from "@/lib/phone-assistant-store";
import { extractSipCaller } from "@/lib/realtime-sip";

type IncomingRealtimeCall = {
  type?: unknown;
  data?: {
    call_id?: unknown;
    sip_headers?: Array<{ name?: unknown; value?: unknown }>;
  };
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const webhookSecret = process.env.OPENAI_WEBHOOK_SECRET?.trim();
  if (!apiKey || !webhookSecret || !env.SIP_CALLS) {
    return new Response("Realtime SIP is not configured.", { status: 503 });
  }

  const body = await request.text();
  let event: IncomingRealtimeCall;
  try {
    const client = new OpenAI({ apiKey, webhookSecret });
    event = (await client.webhooks.unwrap(body, request.headers)) as IncomingRealtimeCall;
  } catch (error) {
    console.error("Rejected invalid OpenAI webhook", error);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type !== "realtime.call.incoming") {
    return Response.json({ received: true });
  }

  const callId = typeof event.data?.call_id === "string"
    ? event.data.call_id.trim()
    : "";
  if (!/^rtc_[A-Za-z0-9_-]{8,}$/u.test(callId)) {
    return new Response("Invalid call", { status: 400 });
  }

  const caller = extractSipCaller(event.data?.sip_headers);
  if (!(await beginPhoneCall(callId, caller))) {
    await rejectRealtimeCall(callId, apiKey, 486);
    return Response.json({ received: true, rejected: true });
  }

  try {
    const preferences = await getUserPreferences("owner");
    const id = env.SIP_CALLS.idFromName(callId);
    const controller = env.SIP_CALLS.get(id);
    const response = await controller.fetch("https://vox.internal/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId,
        origin: new URL(request.url).origin,
        voice: preferences.voice,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`SIP controller returned ${response.status}: ${detail.slice(0, 200)}`);
    }
    return Response.json({ received: true });
  } catch (error) {
    console.error("Could not start Realtime SIP call", error);
    await endPhoneCall(callId).catch(() => undefined);
    await rejectRealtimeCall(callId, apiKey, 500).catch(() => undefined);
    return new Response("Could not start call", { status: 502 });
  }
}

async function rejectRealtimeCall(callId: string, apiKey: string, statusCode: number) {
  await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/reject`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status_code: statusCode }),
  });
}

