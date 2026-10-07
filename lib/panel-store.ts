import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { dashboardPanels } from "@/db/schema";
import { MAX_DASHBOARD_PANELS, type DashboardPanel } from "@/lib/dashboard";
import type { StageBlock, StageSource } from "@/lib/stage";

// Dashboard panels. Everything a panel says (its title, the question, the
// facts, and the pages they came from) is stored encrypted and bound to its
// owner and id.

type PanelPayload = { title: string; question: string; blocks: StageBlock[]; sources: StageSource[] };
type PanelRow = typeof dashboardPanels.$inferSelect;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function panelKey() {
  const secret =
    process.env.VOX_CONVERSATION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-conversation-secret" : "");
  if (!secret) throw new Error("Vox panel security is not configured.");
  // Its own key, derived separately from the conversation key.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`dashboard-panels:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** A panel's ciphertext only opens for the owner and id it was written for. */
function panelBinding(ownerId: string, id: string) {
  return new TextEncoder().encode(`${ownerId}:${id}`);
}

async function encryptPanel(payload: PanelPayload, ownerId: string, id: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: panelBinding(ownerId, id) },
    await panelKey(),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

async function decryptPanel(row: PanelRow): Promise<DashboardPanel | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(row.iv), additionalData: panelBinding(row.ownerId, row.id) },
      await panelKey(),
      base64UrlToBytes(row.ciphertext),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<PanelPayload>;
    return {
      id: row.id,
      title: typeof payload.title === "string" ? payload.title : "",
      question: typeof payload.question === "string" ? payload.question : "",
      blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      refreshedAt: row.refreshedAt,
    };
  } catch {
    return null;
  }
}

export class PanelLimitError extends Error {}

export async function countPanels(ownerId: string) {
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(dashboardPanels)
    .where(eq(dashboardPanels.ownerId, ownerId));
  return Number(count);
}

/** The owner's panels in the order they chose, oldest first within a position. */
export async function listPanels(ownerId: string): Promise<DashboardPanel[]> {
  const rows = await getDb()
    .select()
    .from(dashboardPanels)
    .where(eq(dashboardPanels.ownerId, ownerId))
    .orderBy(asc(dashboardPanels.position), asc(dashboardPanels.createdAt))
    .limit(MAX_DASHBOARD_PANELS);
  const panels = await Promise.all(rows.map(decryptPanel));
  return panels.filter((panel): panel is DashboardPanel => panel !== null);
}

export async function getPanel(ownerId: string, id: string): Promise<DashboardPanel | null> {
  const [row] = await getDb()
    .select()
    .from(dashboardPanels)
    .where(and(eq(dashboardPanels.id, id), eq(dashboardPanels.ownerId, ownerId)))
    .limit(1);
  return row ? decryptPanel(row) : null;
}

/** Adds a panel after the owner's others. Throws PanelLimitError at the limit. */
export async function createPanel(ownerId: string, payload: PanelPayload): Promise<DashboardPanel> {
  if ((await countPanels(ownerId)) >= MAX_DASHBOARD_PANELS) {
    throw new PanelLimitError("Remove a panel before adding another.");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const encrypted = await encryptPanel(payload, ownerId, id);
  // The limit is part of the insert itself, so two requests at once can't both pass it.
  await getDb().run(sql`
    INSERT INTO dashboard_panels (id, owner_id, position, ciphertext, iv, refreshed_at, created_at)
    SELECT ${id}, ${ownerId},
      (SELECT COALESCE(MAX(position), -1) + 1 FROM dashboard_panels WHERE owner_id = ${ownerId}),
      ${encrypted.ciphertext}, ${encrypted.iv}, ${now}, ${now}
    WHERE (SELECT COUNT(*) FROM dashboard_panels WHERE owner_id = ${ownerId}) < ${MAX_DASHBOARD_PANELS}
  `);
  const [saved] = await getDb()
    .select({ id: dashboardPanels.id })
    .from(dashboardPanels)
    .where(and(eq(dashboardPanels.id, id), eq(dashboardPanels.ownerId, ownerId)))
    .limit(1);
  if (!saved) throw new PanelLimitError("Remove a panel before adding another.");
  return { id, ...payload, refreshedAt: now };
}

/** Replaces a panel's contents after a refresh. Null if the owner has no such panel. */
export async function updatePanel(ownerId: string, id: string, payload: PanelPayload): Promise<DashboardPanel | null> {
  const now = new Date().toISOString();
  const encrypted = await encryptPanel(payload, ownerId, id);
  const result = await getDb()
    .update(dashboardPanels)
    .set({ ciphertext: encrypted.ciphertext, iv: encrypted.iv, refreshedAt: now })
    .where(and(eq(dashboardPanels.id, id), eq(dashboardPanels.ownerId, ownerId)))
    .returning({ id: dashboardPanels.id });
  return result.length ? { id, ...payload, refreshedAt: now } : null;
}

export async function removePanel(ownerId: string, id: string) {
  const result = await getDb()
    .delete(dashboardPanels)
    .where(and(eq(dashboardPanels.id, id), eq(dashboardPanels.ownerId, ownerId)))
    .returning({ id: dashboardPanels.id });
  return result.length > 0;
}
