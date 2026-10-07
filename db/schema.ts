import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default("owner"),
    category: text("category").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull().default("conversation"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_memories_owner_updated_at").on(table.ownerId, table.updatedAt),
  ],
);

export const agentFiles = sqliteTable(
  "agent_files",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default("owner"),
    name: text("name").notNull(),
    title: text("title").notNull(),
    purpose: text("purpose").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    objectKey: text("object_key").notNull().unique(),
    content: text("content").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_agent_files_owner_created_at").on(table.ownerId, table.createdAt),
  ],
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default("owner"),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: text("due_at").notNull(),
    status: text("status").notNull().default("pending"),
    source: text("source").notNull().default("conversation"),
    notifiedAt: text("notified_at"),
    delivery: text("delivery").notNull().default("app"),
    callStatus: text("call_status"),
    callAttempts: integer("call_attempts").notNull().default(0),
    calledAt: text("called_at"),
    // Location reminders fire on the iPhone. The server keeps only the place
    // name and whether to fire on arrival or departure, never coordinates.
    triggerType: text("trigger_type").notNull().default("time"),
    place: text("place"),
    placeEvent: text("place_event"),
    locationStatus: text("location_status"),
    // Repeating reminders: the validated rule as JSON (lib/reminder-repeat.ts),
    // and the due time of the occurrence that last went off and is not yet
    // marked done. Both null for a one-time reminder.
    repeatRule: text("repeat_rule"),
    lastOccurrenceAt: text("last_occurrence_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_reminders_owner_due_at").on(table.ownerId, table.dueAt),
    index("idx_reminders_delivery_status_due_at").on(
      table.delivery,
      table.status,
      table.dueAt,
    ),
    index("idx_reminders_owner_status_due_at").on(
      table.ownerId,
      table.status,
      table.dueAt,
    ),
  ],
);

export const activationCodes = sqliteTable(
  "activation_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    codeHash: text("code_hash").notNull().unique(),
    displayName: text("display_name").notNull().default("Vox member"),
    createdBy: text("created_by").notNull(),
    creatorSlot: text("creator_slot").notNull().unique(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_activation_codes_created_by").on(table.createdBy),
  ],
);

export const userContacts = sqliteTable("user_contacts", {
  userId: text("user_id").primaryKey(),
  emailHash: text("email_hash").notNull().unique(),
  emailCiphertext: text("email_ciphertext").notNull(),
  emailIv: text("email_iv").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userPreferences = sqliteTable("user_preferences", {
  ownerId: text("owner_id").primaryKey(),
  replyLength: text("reply_length").notNull().default("balanced"),
  voice: text("voice").notNull().default("marin"),
  initiative: text("initiative").notNull().default("balanced"),
  theme: text("theme").notNull().default("ambient"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const conversationThreads = sqliteTable("conversation_threads", {
  ownerId: text("owner_id").primaryKey(),
  generation: integer("generation").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const socialInteractionState = sqliteTable("social_interaction_state", {
  ownerId: text("owner_id").primaryKey(),
  lastMorningDate: text("last_morning_date"),
  lastNightDate: text("last_night_date"),
  lastNaturalCallbackAt: text("last_natural_callback_at"),
  lastEmotionalFollowupAt: text("last_emotional_followup_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const visionUsage = sqliteTable("vision_usage", {
  ownerId: text("owner_id").primaryKey(),
  hourBucket: text("hour_bucket").notNull().default(""),
  hourCount: integer("hour_count").notNull().default(0),
  dayBucket: text("day_bucket").notNull().default(""),
  dayCount: integer("day_count").notNull().default(0),
  lastAnalysisAt: text("last_analysis_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const conversationMessages = sqliteTable(
  "conversation_messages",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    ownerId: text("owner_id").notNull(),
    role: text("role").notNull(),
    source: text("source").notNull().default("local"),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    // When the owner marked an incoming text or answered call as read, on any device.
    readAt: text("read_at"),
  },
  (table) => [
    uniqueIndex("conversation_messages_id_unique").on(table.id),
    index("idx_conversation_messages_owner_sequence").on(
      table.ownerId,
      table.sequence,
    ),
  ],
);

export const remoteDevices = sqliteTable(
  "remote_devices",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull().default("Mac"),
    status: text("status").notNull().default("pending"),
    claimId: text("claim_id"),
    claimLabel: text("claim_label"),
    claimProof: text("claim_proof"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    pairedAt: text("paired_at"),
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    index("idx_remote_devices_owner_status").on(table.ownerId, table.status),
  ],
);

export const remoteCommands = sqliteTable(
  "remote_commands",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    deviceId: text("device_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    status: text("status").notNull().default("pending"),
    resultCiphertext: text("result_ciphertext"),
    resultIv: text("result_iv"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_remote_commands_device_status_created").on(
      table.deviceId,
      table.status,
      table.createdAt,
    ),
    index("idx_remote_commands_owner_created").on(table.ownerId, table.createdAt),
  ],
);

export const phoneAssistantSettings = sqliteTable(
  "phone_assistant_settings",
  {
    ownerId: text("owner_id").primaryKey(),
    passphraseHash: text("passphrase_hash").unique(),
    passphraseLength: integer("passphrase_length").notNull().default(0),
    phoneHash: text("phone_hash").unique(),
    phoneCiphertext: text("phone_ciphertext"),
    phoneIv: text("phone_iv"),
    phoneLastFour: text("phone_last_four"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    allowOutbound: integer("allow_outbound", { mode: "boolean" }).notNull().default(false),
    // Any caller, verified or not, may ask where the owner's iPhone is.
    shareLocationWithCallers: integer("share_location_with_callers", { mode: "boolean" }).notNull().default(false),
    // "Text me when something needs me": Vox may text the callback number on
    // its own (nudges, a morning briefing, an evening review). On unless the
    // owner turns it off; it does nothing without a callback number.
    proactiveTexts: integer("proactive_texts", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_phone_assistant_passphrase_hash").on(table.passphraseHash),
  ],
);

export const phoneCallSessions = sqliteTable(
  "phone_call_sessions",
  {
    callSid: text("call_sid").primaryKey(),
    ownerId: text("owner_id"),
    callerHash: text("caller_hash").notNull(),
    status: text("status").notNull().default("pending_phrase"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("idx_phone_call_sessions_owner_expires").on(
      table.ownerId,
      table.expiresAt,
    ),
  ],
);

// Vox as a sign-in provider ("Sign in with Vox") for sites the user approves,
// such as Vox Flash Cards. Clients register dynamically and use PKCE.
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  ownerId: text("owner_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: text("expires_at").notNull(),
});

// Short-lived identity tokens; they only unlock /api/oauth/userinfo.
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    ownerId: text("owner_id").notNull(),
    clientId: text("client_id").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("idx_oauth_tokens_expires").on(table.expiresAt)],
);

// Vox as an MCP client: its registration with each MCP authorization server,
// in-flight connection attempts, and each user's encrypted connection tokens.
export const mcpClientRegistrations = sqliteTable("mcp_client_registrations", {
  issuer: text("issuer").primaryKey(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  authorizationEndpoint: text("authorization_endpoint").notNull(),
  tokenEndpoint: text("token_endpoint").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mcpAuthStates = sqliteTable("mcp_auth_states", {
  stateHash: text("state_hash").primaryKey(),
  ownerId: text("owner_id").notNull(),
  serverUrl: text("server_url").notNull(),
  issuer: text("issuer").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const mcpConnections = sqliteTable(
  "mcp_connections",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    serverUrl: text("server_url").notNull(),
    issuer: text("issuer").notNull(),
    accessCiphertext: text("access_ciphertext").notNull(),
    accessIv: text("access_iv").notNull(),
    accessExpiresAt: text("access_expires_at").notNull(),
    refreshCiphertext: text("refresh_ciphertext"),
    refreshIv: text("refresh_iv"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_mcp_connections_owner_server").on(table.ownerId, table.serverUrl)],
);

// Devices that share their location with Vox (the iPhone app today; any
// device later). Each pings with its own token, stored only as a hash.
export const locationDevices = sqliteTable(
  "location_devices",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("other"),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    uniqueIndex("location_devices_token_hash_unique").on(table.tokenHash),
    index("idx_location_devices_owner").on(table.ownerId),
  ],
);

// Recent positions per device, encrypted (coordinates, accuracy, place name).
export const locationPings = sqliteTable(
  "location_pings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    deviceId: text("device_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    capturedAt: text("captured_at").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [index("idx_location_pings_device_captured").on(table.deviceId, table.capturedAt)],
);

// Dashboard panels: things the user asked Vox to keep an eye on. The whole
// panel (title, question, facts, sources) is encrypted.
export const dashboardPanels = sqliteTable(
  "dashboard_panels",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    position: integer("position").notNull().default(0),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    refreshedAt: text("refreshed_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_dashboard_panels_owner_position").on(table.ownerId, table.position)],
);

// Today briefing: JEV's verdict on an unread email, kept so each message is
// judged once. `id` is a hash of the owner and the message id; no email
// content is stored. Rows older than about 30 days are pruned.
export const mailTriage = sqliteTable(
  "mail_triage",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    // "needs_you" | "worth_reading" | "skip"
    verdict: text("verdict").notNull(),
    judgedAt: text("judged_at").notNull(),
  },
  (table) => [index("idx_mail_triage_owner_judged_at").on(table.ownerId, table.judgedAt)],
);

// Today briefing: the last "now" decision per user. `signature` is a hash of
// the candidate set and the local hour it was made for; `chosen` is a JSON
// array of the chosen candidate keys ("event:<id>").
export const todayNowCache = sqliteTable("today_now_cache", {
  ownerId: text("owner_id").primaryKey(),
  signature: text("signature").notNull(),
  chosen: text("chosen").notNull(),
  decidedAt: text("decided_at").notNull(),
});

// The owner profile Vox builds overnight from the day's conversations. The
// profile itself (facts, the day's digest, and what the owner had Vox forget)
// is encrypted and bound to its owner; the rest is bookkeeping for the nightly
// run: where the owner is, how far through the conversation it has read, and
// how the last run went.
export const userProfiles = sqliteTable("user_profiles", {
  ownerId: text("owner_id").primaryKey(),
  ciphertext: text("ciphertext"),
  iv: text("iv"),
  // IANA zone, and whether the owner's device ("device") or the network
  // ("network") reported it.
  timeZone: text("time_zone"),
  timeZoneSource: text("time_zone_source"),
  // conversation_messages.sequence of the last message already folded in.
  lastSequence: integer("last_sequence").notNull().default(0),
  // Local day (YYYY-MM-DD) the nightly run last finished for.
  consolidatedDay: text("consolidated_day"),
  lastRunAt: text("last_run_at"),
  lastRunStatus: text("last_run_status"),
  lastRunTrigger: text("last_run_trigger"),
  lastRunMessages: integer("last_run_messages").notNull().default(0),
  lastRunError: text("last_run_error"),
  lastSuccessAt: text("last_success_at"),
  // Set while a run is under way, so two never overlap.
  runStartedAt: text("run_started_at"),
  // Last "Update now", for its rate limit.
  manualRunAt: text("manual_run_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// What the background check has already dealt with, so nothing is texted
// twice. One row per thing (an email, an invitation, a task, an event) per
// owner, known only by a hash of its key: none of its words, and no address,
// is stored. `status` is what became of it: "sent" (texted), "briefed" (covered
// by a morning briefing or evening review), "wait" (JEV: leave it for the
// briefing), or "never" (JEV: not worth a text). Rows are dropped 14 days
// after the thing was last seen.
export const proactiveTextKeys = sqliteTable(
  "proactive_text_keys",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    seenAt: text("seen_at").notNull(),
  },
  (table) => [index("idx_proactive_text_keys_owner_seen").on(table.ownerId, table.seenAt)],
);

// Every text Vox set out to send on its own: which kind ("nudge", "morning",
// "evening"), when, and how it went ("sending", "sent", "error", or "skipped"
// when there was nothing to say). Never the text itself. The daily cap, the
// spacing between texts, and "once per local day" are all read from here.
export const proactiveTextLog = sqliteTable(
  "proactive_text_log",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    // The owner's own calendar date (YYYY-MM-DD) when it was decided.
    localDay: text("local_day").notNull(),
    items: integer("items").notNull().default(0),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_proactive_text_log_owner_created").on(table.ownerId, table.createdAt)],
);
