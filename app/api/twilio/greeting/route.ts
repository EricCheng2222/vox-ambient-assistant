import { say, twiml, validateTwilioRequest } from "@/lib/twilio";

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  if (!(await validateTwilioRequest(request, form))) {
    return new Response("Forbidden", { status: 403 });
  }

  return twiml(`${say("Hi")}<Hangup/>`);
}
