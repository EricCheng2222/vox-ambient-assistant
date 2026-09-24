import { handlePhoneAssistantPrompt } from "@/lib/phone-assistant";
import {
  authenticatedPhoneCallOwner,
  beginPhoneCall,
  endPhoneCall,
  verifyPhoneCallPassphrase,
} from "@/lib/phone-assistant-store";
import {
  dialSip,
  gatherSpeech,
  say,
  twiml,
  validateTwilioRequest,
} from "@/lib/twilio";
import { openAiSipProjectId, openAiSipUri } from "@/lib/realtime-sip";

const maximumSilentCommandTurns = 3;
const maximumSilentPhraseTurns = 2;

function actionUrl(request: Request, stage: string, silentTurns = 0) {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("stage", stage);
  if (silentTurns > 0) url.searchParams.set("silent", String(silentTurns));
  return url.toString();
}

function silentTurns(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("silent") ?? "0");
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 10) : 0;
}

function commandListeningPrompt(attempt: number) {
  if (attempt === 1) return "我還在，慢慢說就好。";
  if (attempt === 2) return "你可以慢慢想，我還在聽。";
  return "我還在這裡。如果暫時沒事，也可以說下次再聊。";
}

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  if (!(await validateTwilioRequest(request, form))) {
    return new Response("Forbidden", { status: 403 });
  }

  const callSid = form.get("CallSid")?.trim() ?? "";
  if (!/^CA[a-f0-9]{32}$/iu.test(callSid)) return new Response("Invalid call", { status: 400 });
  const stage = new URL(request.url).searchParams.get("stage") ?? "start";

  if (stage === "start") {
    const sipProjectId = openAiSipProjectId();
    if (sipProjectId) {
      return twiml(dialSip(openAiSipUri(sipProjectId)));
    }
    const accepted = await beginPhoneCall(callSid, form.get("From") ?? "");
    if (!accepted) {
      return twiml(`${say("嘗試次數過多，請稍後再試。") }<Hangup/>`);
    }
    return twiml(
      gatherSpeech(
        actionUrl(request, "phrase"),
        "你好，我是 Vox。請說出你設定的私人驗證句。請不要在其他人能聽到的地方使用。",
      ) + `${say("沒有收到驗證句，本次通話將結束。") }<Hangup/>`,
    );
  }

  if (stage === "phrase") {
    const phrase = form.get("SpeechResult")?.trim().slice(0, 500) ?? "";
    const silent = silentTurns(request);
    if (!phrase) {
      if (silent >= maximumSilentPhraseTurns) {
        await endPhoneCall(callSid);
        return twiml(`${say("沒有收到驗證句，本次通話將結束。") }<Hangup/>`);
      }
      return twiml(
        gatherSpeech(
          actionUrl(request, "phrase", silent + 1),
          silent === 0
            ? "我還在。準備好時，請說出你的私人驗證句。"
            : "請說出私人驗證句，或稍後再撥。",
        ),
      );
    }
    const ownerId = await verifyPhoneCallPassphrase(
      callSid,
      phrase,
    );
    if (!ownerId) {
      return twiml(`${say("驗證句不正確。為了安全，本次通話將結束。") }<Hangup/>`);
    }
    return twiml(
      gatherSpeech(
        actionUrl(request, "command"),
        "驗證完成。我在聽，你想聊什麼？",
      ),
    );
  }

  if (stage === "command") {
    const ownerId = await authenticatedPhoneCallOwner(callSid);
    if (!ownerId) return twiml(`${say("通話驗證已經失效，請重新撥打。") }<Hangup/>`);
    const speech = form.get("SpeechResult")?.trim().slice(0, 2000) ?? "";
    const silent = silentTurns(request);
    if (!speech) {
      if (silent >= maximumSilentCommandTurns) {
        await endPhoneCall(callSid);
        return twiml(`${say("我先不打擾你。想聊的時候再打給我。") }<Hangup/>`);
      }
      return twiml(
        gatherSpeech(
          actionUrl(request, "command", silent + 1),
          commandListeningPrompt(silent + 1),
        ),
      );
    }
    const result = await handlePhoneAssistantPrompt(ownerId, speech);
    if (result.end) {
      await endPhoneCall(callSid);
      return twiml(`${say(result.answer)}<Hangup/>`);
    }
    // Keep the answer inside Gather so the caller can naturally speak again or
    // interrupt without waiting for a separate, repetitive follow-up prompt.
    return twiml(gatherSpeech(actionUrl(request, "command"), result.answer));
  }

  await endPhoneCall(callSid);
  return twiml(`${say("這次通話已經結束。") }<Hangup/>`);
}
