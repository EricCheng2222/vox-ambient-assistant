const realtimeModel = "gpt-realtime-2.1";
const preAuthenticationIdleMs = 2 * 60_000;
const authenticatedIdleMs = 10 * 60_000;
const realtimeVoices = new Set([
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
]);

const authInstructions = [
  "You are Vox at the locked entrance to a private voice call.",
  "Do not answer questions, continue a conversation, reveal private context, or execute tools before the server confirms authentication.",
  "Ask the caller once, in natural Taiwan Mandarin, to say their private authentication sentence.",
  "Never repeat the sentence back, hint at it, or claim that authentication succeeded on your own.",
  "The server will explicitly update your instructions after verification.",
].join(" ");

const transcriptionPrompt = [
  "The speaker may use English or Mandarin. Mandarin speech must be written in Taiwan Traditional Chinese, not translated into English.",
  "Transcribe only audible speech verbatim, never translate or answer it. Preserve English names and code-switching exactly as spoken. Preserve fillers, hesitation, repetitions and unfinished sentences. Silence is not speech.",
].join(" ");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalizeSpokenPassphrase(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function remoteAssociatedData(deviceId, commandId, purpose) {
  return encoder.encode(`vox-remote-${purpose}-v1:${deviceId}:${commandId}`);
}

async function phoneRelaySecret(passphrase) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(normalizeSpokenPassphrase(passphrase)),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function phoneRelayKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(secret),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptMacCommand(secret, deviceId, commandId, prompt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const now = Date.now();
  const plaintext = encoder.encode(JSON.stringify({
    version: 1,
    commandId,
    nonce: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 2 * 60_000,
    command: { kind: "phone_mac", prompt },
  }));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: remoteAssociatedData(deviceId, commandId, "command"),
    },
    await phoneRelayKey(secret),
    plaintext,
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptMacResult(secret, deviceId, commandId, ciphertext, iv) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(iv),
      additionalData: remoteAssociatedData(deviceId, commandId, "result"),
    },
    await phoneRelayKey(secret),
    base64UrlToBytes(ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext));
}

const phoneTools = [
  {
    type: "function",
    name: "search_web",
    description:
      "Search the live web for current or time-sensitive information. Always use this for current weather, today's news, live schedules, prices, public events, or anything that may have changed. Never claim live information is unavailable before using this tool.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A complete, specific search question including place and date when relevant.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_reminder",
    description: "Create one private Vox reminder after the caller gives a clear future time.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: ["string", "null"] },
        due_at: { type: "string", description: "Future ISO 8601 timestamp with timezone." },
      },
      required: ["title", "notes", "due_at"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_reminders",
    description: "List the caller's nearest pending Vox reminders.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "set_execution_route",
    description:
      "Switch subsequent actionable requests in this phone call between Vox Cloud and the caller's paired Mac. The call starts on cloud. Use this whenever the caller says to use, switch to, route to, or go back to Mac/cloud, including when they combine the switch with an action.",
    parameters: {
      type: "object",
      properties: {
        route: { type: "string", enum: ["cloud", "mac"] },
      },
      required: ["route"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "run_on_mac",
    description:
      "Run an actionable request on the caller's paired Mac, including Computer Use in any locally installed app that Vox is allowed to control. Use only while the execution route is Mac. Pass the caller's complete request, preserving app names, visible context, and constraints. The Mac resolves the target app and enforces its own local safety policy.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
];

export class SipCallDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.socket = null;
    this.callId = null;
    this.origin = null;
    this.authenticated = false;
    this.closed = false;
    this.hangupAfterResponse = false;
    this.skipNextAssistantSync = false;
    this.pendingToolCalls = new Set();
    this.executionRoute = "cloud";
    this.phoneRelaySecret = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/start") {
      return new Response("Not found", { status: 404 });
    }
    try {
      const body = await request.json();
      await this.start(body);
      return Response.json({ started: true });
    } catch (error) {
      console.error("Realtime SIP controller failed", error);
      return new Response(error instanceof Error ? error.message : "Could not start call", {
        status: 500,
      });
    }
  }

  async start(body) {
    const callId = typeof body?.callId === "string" ? body.callId.trim() : "";
    if (!/^rtc_[A-Za-z0-9_-]{8,}$/u.test(callId)) throw new Error("Invalid call ID.");
    const origin = new URL(String(body?.origin ?? ""));
    if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost") {
      throw new Error("Invalid Vox origin.");
    }
    if (!this.env.OPENAI_API_KEY || !this.internalSecret()) {
      throw new Error("Realtime SIP secrets are unavailable.");
    }

    const stored = await this.state.storage.get("call");
    if (stored?.closed === true) return;
    this.callId = callId;
    this.origin = origin.origin;
    this.authenticated = stored?.authenticated === true;
    const voice = realtimeVoices.has(body?.voice) ? body.voice : "marin";

    if (!stored?.accepted) {
      await this.acceptCall(voice);
      await this.state.storage.put("call", {
        callId,
        origin: this.origin,
        accepted: true,
        authenticated: false,
        closed: false,
      });
    }
    if (!this.socket || this.socket.readyState > 1) await this.connectSideband();
    await this.resetIdleAlarm();
  }

  async acceptCall(voice) {
    const response = await fetch(
      `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(this.callId)}/accept`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "realtime",
          model: realtimeModel,
          output_modalities: ["audio"],
          truncation: {
            type: "retention_ratio",
            retention_ratio: 0.8,
            token_limits: { post_instructions: 8_000 },
          },
          instructions: authInstructions,
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                prompt: transcriptionPrompt,
              },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "auto",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice },
          },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (!/decision_already_made/iu.test(detail)) {
        throw new Error(`OpenAI call acceptance failed (${response.status}).`);
      }
    }
  }

  async connectSideband() {
    const response = await fetch(
      `https://api.openai.com/v1/realtime?call_id=${encodeURIComponent(this.callId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
          Upgrade: "websocket",
        },
      },
    );
    const socket = response.webSocket;
    if (!socket) throw new Error(`OpenAI sideband connection failed (${response.status}).`);
    socket.accept();
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      this.state.waitUntil(this.handleServerEvent(event.data));
    });
    socket.addEventListener("close", () => {
      this.state.waitUntil(this.cleanup());
    });
    socket.addEventListener("error", () => {
      this.state.waitUntil(this.cleanup());
    });
    if (!this.authenticated) {
      this.send({
        type: "response.create",
        response: {
          instructions:
            "In natural Taiwan Mandarin, say exactly one short greeting that identifies you as Vox and asks the caller to say their private authentication sentence. Do not provide examples or hints.",
        },
      });
    }
  }

  async handleServerEvent(raw) {
    let event;
    try {
      event = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(event.transcript ?? "").trim();
      if (!transcript) return;
      if (!this.authenticated) {
        await this.authenticate(transcript);
        return;
      }
      await this.resetIdleAlarm();
      await this.internalRequest({
        action: "sync",
        callId: this.callId,
        role: "user",
        transcript,
        messageId: this.messageId("user", event.item_id),
      }).catch((error) => console.error("Could not sync SIP user transcript", error));
      return;
    }

    if (event.type === "response.output_audio_transcript.done" && this.authenticated) {
      const transcript = String(event.transcript ?? "").trim();
      if (!transcript) return;
      if (this.skipNextAssistantSync) {
        this.skipNextAssistantSync = false;
        return;
      }
      await this.internalRequest({
        action: "sync",
        callId: this.callId,
        role: "assistant",
        transcript,
        messageId: this.messageId("assistant", event.item_id ?? event.response_id),
      }).catch((error) => console.error("Could not sync SIP assistant transcript", error));
      return;
    }

    if (event.type === "response.function_call_arguments.done" && this.authenticated) {
      await this.executeTool(event);
      return;
    }

    if (event.type === "response.done" && this.hangupAfterResponse) {
      await this.hangup();
      return;
    }

    if (event.type === "error") {
      console.error("OpenAI Realtime SIP event error", event.error?.code, event.error?.message);
    }
  }

  async authenticate(transcript) {
    let response;
    try {
      response = await this.internalRequest({
        action: "authenticate",
        callId: this.callId,
        transcript,
      });
    } catch {
      response = null;
    }
    if (!response?.authenticated) {
      this.hangupAfterResponse = true;
      this.send({
        type: "response.create",
        response: {
          instructions:
            "In natural Taiwan Mandarin, say that the private authentication sentence was not recognized and that the call will end for security. Do not repeat or hint at the sentence.",
        },
      });
      return;
    }

    this.authenticated = true;
    this.executionRoute = "cloud";
    this.phoneRelaySecret = await phoneRelaySecret(transcript);
    await this.state.storage.put("call", {
      callId: this.callId,
      origin: this.origin,
      accepted: true,
      authenticated: true,
      closed: false,
    });
    if (response.carryover) {
      this.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: response.carryover }],
        },
      });
    }
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: response.instructions,
        tools: phoneTools,
        tool_choice: "auto",
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-mini-transcribe",
              prompt: transcriptionPrompt,
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "auto",
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
    this.skipNextAssistantSync = true;
    this.send({
      type: "response.create",
      response: {
        instructions:
          "Briefly say in natural Taiwan Mandarin that verification is complete, the call is using Vox Cloud by default, and you are listening. Do not mention implementation details.",
      },
    });
    await this.resetIdleAlarm();
  }

  async executeTool(event) {
    const callId = String(event.call_id ?? "");
    if (!callId || this.pendingToolCalls.has(callId)) return;
    this.pendingToolCalls.add(callId);
    try {
      let args = {};
      try {
        args = JSON.parse(String(event.arguments ?? "{}"));
      } catch {
        args = {};
      }
      let result;
      if (event.name === "set_execution_route") {
        const route = args.route === "mac" ? "mac" : "cloud";
        if (route === "mac") {
          const available = await this.internalRequest({
            action: "mac_device",
            callId: this.callId,
          });
          if (!available?.device?.id) {
            result = {
              output: JSON.stringify({
                ok: false,
                route: this.executionRoute,
                error: "The paired Mac is offline, so the call is still routed to Vox Cloud.",
              }),
            };
          }
        }
        if (!result) {
          this.executionRoute = route;
          result = {
            output: JSON.stringify({
              ok: true,
              route,
              message: route === "mac"
                ? "Execution is now routed to the paired Mac."
                : "Execution is now routed to Vox Cloud.",
            }),
          };
        }
      } else if (event.name === "run_on_mac") {
        result = await this.runOnMac(args.prompt);
      } else {
        result = await this.internalRequest({
          action: "tool",
          callId: this.callId,
          toolName: event.name,
          arguments: args,
        });
      }
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: String(result?.output ?? '{"ok":false,"error":"Tool unavailable."}'),
        },
      });
      this.send({ type: "response.create" });
    } finally {
      this.pendingToolCalls.delete(callId);
    }
  }

  async runOnMac(rawPrompt) {
    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim().slice(0, 12_000) : "";
    if (this.executionRoute !== "mac") {
      return {
        output: JSON.stringify({
          ok: false,
          error: "The call is currently routed to Vox Cloud. Ask the caller to switch to the Mac first.",
        }),
      };
    }
    if (!prompt || !this.phoneRelaySecret) {
      return {
        output: JSON.stringify({ ok: false, error: "The Mac request is incomplete." }),
      };
    }

    const available = await this.internalRequest({
      action: "mac_device",
      callId: this.callId,
    });
    const deviceId = String(available?.device?.id ?? "");
    if (!deviceId) {
      return {
        output: JSON.stringify({
          ok: false,
          error: "The paired Mac is offline. Stay on the call and suggest switching back to cloud.",
        }),
      };
    }

    const commandId = crypto.randomUUID();
    const encrypted = await encryptMacCommand(
      this.phoneRelaySecret,
      deviceId,
      commandId,
      prompt,
    );
    const queued = await this.internalRequest({
      action: "mac_enqueue",
      callId: this.callId,
      messageId: commandId,
      arguments: { deviceId, ...encrypted },
    });
    if (!queued?.queued) {
      return {
        output: JSON.stringify({ ok: false, error: "The Mac could not accept the request." }),
      };
    }

    const deadline = Date.now() + 185_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      const status = await this.internalRequest({
        action: "mac_status",
        callId: this.callId,
        messageId: commandId,
      });
      const command = status?.command;
      if (command?.status === "completed") {
        if (!command.resultCiphertext || !command.resultIv) {
          return {
            output: JSON.stringify({ ok: false, error: "The Mac returned an incomplete result." }),
          };
        }
        const result = await decryptMacResult(
          this.phoneRelaySecret,
          deviceId,
          commandId,
          command.resultCiphertext,
          command.resultIv,
        );
        return { output: JSON.stringify(result) };
      }
      if (command?.expiresAt && Date.parse(command.expiresAt) <= Date.now()) break;
    }
    return {
      output: JSON.stringify({ ok: false, error: "The Mac did not answer in time." }),
    };
  }

  async internalRequest(payload) {
    const response = await fetch(`${this.origin}/api/openai/realtime-sip/internal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vox-Sip-Secret": this.internalSecret(),
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Vox SIP control returned ${response.status}.`);
    return result;
  }

  internalSecret() {
    return String(this.env.VOX_CONTACT_SECRET || this.env.VOX_SESSION_SECRET || "").trim();
  }

  messageId(role, sourceId) {
    const suffix = String(sourceId || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 100);
    return `sip_${role}_${suffix}`;
  }

  send(event) {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("OpenAI sideband is not connected.");
    }
    this.socket.send(JSON.stringify(event));
  }

  async resetIdleAlarm() {
    await this.state.storage.setAlarm(
      Date.now() + (this.authenticated ? authenticatedIdleMs : preAuthenticationIdleMs),
    );
  }

  async alarm() {
    if (this.closed) return;
    if (this.authenticated && this.socket?.readyState === 1) {
      this.hangupAfterResponse = true;
      this.send({
        type: "response.create",
        response: {
          instructions:
            "In natural Taiwan Mandarin, briefly say you will end the quiet call now and the caller can call again whenever they want.",
        },
      });
      await this.state.storage.setAlarm(Date.now() + 20_000);
      return;
    }
    await this.hangup();
  }

  async hangup() {
    if (this.closed) return;
    this.closed = true;
    await fetch(
      `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(this.callId)}/hangup`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` },
      },
    ).catch(() => undefined);
    try {
      this.socket?.close(1000, "Call ended");
    } catch {
      // The carrier may already have closed the media connection.
    }
    await this.cleanup();
  }

  async cleanup() {
    if (!this.callId || !this.origin) return;
    if (!this.closed) this.closed = true;
    await this.state.storage.put("call", {
      callId: this.callId,
      origin: this.origin,
      accepted: true,
      authenticated: this.authenticated,
      closed: true,
    });
    await this.state.storage.deleteAlarm().catch(() => undefined);
    await this.internalRequest({ action: "close", callId: this.callId }).catch(() => undefined);
  }
}
