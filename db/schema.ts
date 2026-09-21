import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_reminders_owner_due_at").on(table.ownerId, table.dueAt),
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
