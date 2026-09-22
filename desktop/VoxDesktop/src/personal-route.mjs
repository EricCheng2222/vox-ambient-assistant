const routes = new Set(["silence", "realtime", "desktop_control", "local_codex"]);
const turnStates = new Set(["wait", "complete"]);
const contextModes = new Set(["continue", "fresh"]);
const postures = new Set(["acknowledge", "listen", "joke", "ask", "share", "answer", "advise", "repair"]);
const lengths = new Set(["minimal", "brief", "standard", "detailed", "expansive"]);
const visionNeeds = new Set(["none", "inspect_low", "inspect_high"]);
const personalPresenceActions = new Set(["stay_silent", "check_in", "continue_topic"]);

export function validTypeSafeKey(value) {
  return typeof value === "string" && /^apikey_[A-Za-z0-9_-]{20,}$/u.test(value.trim());
}

function cleanMessage(message) {
  if (!message || (message.role !== "user" && message.role !== "assistant")) return null;
  if (typeof message.text !== "string") return null;
  return { role: message.role, text: message.text.slice(0, 400) };
}

function choice(answers, name, allowed, fallback) {
  const value = answers?.[name]?.choice;
  return allowed.has(value) ? value : fallback;
}

function fallbackRoute(body) {
  const text = `${body.pendingText || ""} ${body.text || ""}`.trim();
  if (!text || /^(?:um+|uh+|hmm+|嗯+|呃+|欸+)[.!?。！？,， ]*$/iu.test(text)) return "silence";
  if (body.localCodexAvailable && /\b(?:codex|coding agent|local agent)\b|(?:交給|用|叫|讓|請).{0,24}(?:codex|本機代理|程式代理)/iu.test(text)) return "local_codex";
  return "realtime";
}

export async function createPersonalRoute(apiKey, body = {}, fetchImpl = fetch) {
  if (!validTypeSafeKey(apiKey)) throw new Error("Add a valid TypeSafe API key first.");
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 6000) : "";
  const pendingText = typeof body.pendingText === "string" ? body.pendingText.trim().slice(0, 6000) : "";
  if (!text) return { route: "silence", turnState: "complete", contextMode: "continue" };

  const recentMessages = Array.isArray(body.recentMessages)
    ? body.recentMessages.map(cleanMessage).filter(Boolean).slice(-6)
    : [];
  const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: {
        current_utterance: text,
        pending_utterance: pendingText || null,
        voice_pause_detection_enabled: body.allowWait !== false,
        delivery_timing: body.timing ?? null,
        recent_conversation: recentMessages,
        reply_length_preference: ["less", "balanced", "more"].includes(body.replyLength)
          ? body.replyLength
          : "balanced",
        camera_preview_available: body.visionAvailable === true,
        local_codex_available: body.localCodexAvailable === true,
        desktop_control_available: body.desktopControlAvailable === true,
        recent_desktop_app:
          typeof body.desktopAppContext === "string" ? body.desktopAppContext.slice(0, 80) : null,
      },
      questions: {
        turn_state: {
          type: "choice",
          instructions: "Choose wait only when the person is clearly pausing mid-thought, trailing off, or continuing an unfinished utterance. A standalone filler is complete and should route to silence. If voice pause detection is disabled, choose complete.",
          criteria: { wait: "Keep listening without a voice reply.", complete: "Respond or act now." },
        },
        route: {
          type: "choice",
          instructions: "Route an ambient desktop voice assistant. Choose silence for filler, background speech, or explicit no-reply requests. Choose local_codex only for an explicit request to delegate substantive software work to local Codex. Choose desktop_control only for an explicit request to launch or interact with an installed app. Choose realtime for all ordinary conversation, factual questions, analysis, and requests the voice model can answer. Personal mode has no Vox cloud reminders, files, memory, or search services.",
          criteria: {
            silence: "Do not speak.",
            realtime: "Use the live voice model.",
            desktop_control: "Use an installed desktop app.",
            local_codex: "Delegate software work to local Codex.",
          },
        },
        desktop_app: {
          type: "choice",
          instructions: "Infer the target app only for a computer action. Use the recent app for follow-ups. Choose Safari for an unnamed browser and none for ordinary conversation.",
          criteria: {
            none: "No app action.", safari: "Safari", chrome: "Google Chrome", finder: "Finder",
            preview: "Preview", notes: "Notes", calculator: "Calculator", textedit: "TextEdit",
            vscode: "Visual Studio Code", music: "Apple Music", mail: "Mail", messages: "Messages",
            calendar: "Calendar", reminders: "Reminders", photos: "Photos", maps: "Maps",
          },
        },
        computer_use_mode: {
          type: "choice",
          instructions: "Choose fast for one obvious routine action and standard for multi-step, ambiguous, or interpretive interaction.",
          criteria: { fast: "One clear action.", standard: "Multiple or ambiguous actions." },
        },
        context_mode: {
          type: "choice",
          instructions: "Choose continue for follow-ups, references, corrections, or uncertainty. Choose fresh only for a clearly unrelated self-contained topic.",
          criteria: { continue: "Keep recent dialogue.", fresh: "Start a new topic context." },
        },
        conversation_move: {
          type: "choice",
          instructions: "Choose the socially natural next move. Advice is only for explicit advice requests or immediate safety. Prefer listening or acknowledging for personal sharing.",
          criteria: {
            acknowledge: "React naturally.", listen: "Hear emotion without fixing.", joke: "Match playful tone.",
            ask: "Ask one useful low-pressure question.", share: "Add one relevant thought.", answer: "Answer directly.",
            advise: "Give requested guidance.", repair: "Correct a conversational mismatch.",
          },
        },
        response_length: {
          type: "choice",
          instructions: "Loosely mirror the user's amount of speech, then apply their less, balanced, or more preference without using a fixed quota.",
          criteria: {
            minimal: "One phrase or sentence.", brief: "A few short sentences.", standard: "A normal complete answer.",
            detailed: "Developed explanation.", expansive: "Full exploration with reasoning or examples.",
          },
        },
        visual_need: {
          type: "choice",
          instructions: "Choose image inspection only when the user explicitly asks Vox to look through the camera. Use inspect_high only for small text or fine detail.",
          criteria: { none: "No image.", inspect_low: "One auto-detail frame.", inspect_high: "One detailed frame." },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw new Error("TypeSafe rejected this API key. Replace it and try again.");
  }
  if (!response.ok) {
    return {
      route: fallbackRoute(body),
      turnState: "complete",
      contextMode: "continue",
      source: "fallback",
    };
  }

  const answers = payload?.answers ?? {};
  return {
    route: choice(answers, "route", routes, fallbackRoute(body)),
    desktopApp: answers.desktop_app?.choice ?? "none",
    desktopAppConfidence: answers.desktop_app?.confidence ?? 0,
    computerUseMode: answers.computer_use_mode?.choice === "fast" ? "fast" : "standard",
    turnState: body.allowWait === false ? "complete" : choice(answers, "turn_state", turnStates, "complete"),
    contextMode: pendingText ? "continue" : choice(answers, "context_mode", contextModes, "continue"),
    responsePosture: choice(answers, "conversation_move", postures, "acknowledge"),
    responseLength: choice(answers, "response_length", lengths, "standard"),
    memoryUse: "none",
    ritual: "none",
    visionNeed: choice(answers, "visual_need", visionNeeds, "none"),
    visionBlocked: null,
    source: "jev",
  };
}

export async function createPersonalPresence(apiKey, body = {}, fetchImpl = fetch) {
  if (!validTypeSafeKey(apiKey)) throw new Error("Add a valid TypeSafe API key first.");
  const initiative = ["off", "quiet", "balanced", "social"].includes(body.initiative)
    ? body.initiative
    : "balanced";
  const proactiveCount = Math.max(0, Number(body.proactiveCount) || 0);
  if (initiative === "off" || proactiveCount >= 6) {
    return { action: "stay_silent", source: "guardrail" };
  }

  const recentMessages = Array.isArray(body.recentMessages)
    ? body.recentMessages.map(cleanMessage).filter(Boolean).slice(-6)
    : [];
  const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: {
        initiative,
        quiet_seconds: Math.round(Math.max(0, Number(body.quietForMs) || 0) / 1000),
        seconds_since_assistant: Math.round(
          Math.max(0, Number(body.sinceAssistantMs) || 0) / 1000,
        ),
        proactive_count: proactiveCount,
        current_time: new Date().toISOString(),
        recent_conversation: recentMessages,
        personal_mode: true,
      },
      questions: {
        timing: {
          type: "choice",
          instructions:
            "Decide whether an ambient voice companion should speak first right now. Strongly prefer silence. Never speak merely because a timer elapsed. Speak only when a brief contribution is grounded in the recent conversation and would clearly feel natural and welcome. Personal mode has no saved cloud memory, so do not invent callbacks, rituals, reminders, or facts outside the provided conversation. Interpret quiet as low initiative, balanced as moderate initiative, and social as higher initiative, while still requiring a real reason to talk.",
          criteria: {
            stay_silent: "There is no clearly useful or socially natural reason to speak now.",
            check_in: "A short, low-pressure check-in would be welcome and not intrusive.",
            continue_topic:
              "A concise follow-up grounded in a concrete unfinished thread would add value now.",
          },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw new Error("TypeSafe rejected this API key. Replace it and try again.");
  }
  if (!response.ok) return { action: "stay_silent", source: "fallback" };

  return {
    action: choice(payload?.answers, "timing", personalPresenceActions, "stay_silent"),
    confidence: payload?.answers?.timing?.confidence ?? null,
    source: "jev",
  };
}
