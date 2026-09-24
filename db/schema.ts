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
