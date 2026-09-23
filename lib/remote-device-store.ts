import { and, asc, eq, gt, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { remoteCommands, remoteDevices } from "@/db/schema";

const MAX_PENDING_COMMANDS = 12;

export async function createRemoteDevice(
  ownerId: string,
  input: { id: string; name: string; expiresAt: string },
) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.run(sql`
    DELETE FROM remote_devices
    WHERE owner_id = ${ownerId}
      AND status = 'pending'
      AND expires_at <= ${now}
  `);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(remoteDevices)
    .where(eq(remoteDevices.ownerId, ownerId));
  if (Number(count) >= 8) throw new Error("Remote device limit reached.");
  await db.insert(remoteDevices).values({
    id: input.id,
    ownerId,
    name: input.name,
    expiresAt: input.expiresAt,
  });
  return getRemoteDevice(ownerId, input.id);
}

export async function getRemoteDevice(ownerId: string, id: string) {
  const [device] = await getDb()
    .select()
    .from(remoteDevices)
    .where(and(eq(remoteDevices.ownerId, ownerId), eq(remoteDevices.id, id)))
    .limit(1);
  return device ?? null;
}

export async function claimRemoteDevice(
  ownerId: string,
  input: { id: string; claimId: string; label: string; proof: string },
) {
  const now = new Date().toISOString();
  await getDb()
    .update(remoteDevices)
    .set({
      claimId: input.claimId,
      claimLabel: input.label,
      claimProof: input.proof,
      lastSeenAt: now,
    })
    .where(
      and(
        eq(remoteDevices.ownerId, ownerId),
        eq(remoteDevices.id, input.id),
        eq(remoteDevices.status, "pending"),
        gt(remoteDevices.expiresAt, now),
      ),
    );
  return getRemoteDevice(ownerId, input.id);
}

export async function activateRemoteDevice(ownerId: string, id: string) {
  const now = new Date().toISOString();
  await getDb()
    .update(remoteDevices)
    .set({ status: "active", pairedAt: now, lastSeenAt: now })
    .where(
      and(
        eq(remoteDevices.ownerId, ownerId),
        eq(remoteDevices.id, id),
        eq(remoteDevices.status, "pending"),
      ),
    );
  return getRemoteDevice(ownerId, id);
}

export async function touchRemoteDevice(ownerId: string, id: string) {
  await getDb()
    .update(remoteDevices)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(and(eq(remoteDevices.ownerId, ownerId), eq(remoteDevices.id, id)));
}

export async function revokeRemoteDevice(ownerId: string, id: string) {
  const db = getDb();
  await db
    .delete(remoteCommands)
    .where(and(eq(remoteCommands.ownerId, ownerId), eq(remoteCommands.deviceId, id)));
  await db
    .delete(remoteDevices)
    .where(and(eq(remoteDevices.ownerId, ownerId), eq(remoteDevices.id, id)));
}

export async function enqueueRemoteCommand(
  ownerId: string,
  input: {
    id: string;
    deviceId: string;
    ciphertext: string;
    iv: string;
    expiresAt: string;
  },
) {
  const db = getDb();
  const now = new Date().toISOString();
  const [device] = await db
    .select({ id: remoteDevices.id })
    .from(remoteDevices)
    .where(
      and(
        eq(remoteDevices.ownerId, ownerId),
        eq(remoteDevices.id, input.deviceId),
        eq(remoteDevices.status, "active"),
      ),
    )
    .limit(1);
  if (!device) return false;

  await db.run(sql`
    DELETE FROM remote_commands
    WHERE owner_id = ${ownerId}
      AND (expires_at <= ${now} OR created_at < datetime('now', '-1 day'))
  `);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(remoteCommands)
    .where(
      and(
        eq(remoteCommands.ownerId, ownerId),
        eq(remoteCommands.deviceId, input.deviceId),
        eq(remoteCommands.status, "pending"),
      ),
    );
  if (Number(count) >= MAX_PENDING_COMMANDS) return false;

  await db.insert(remoteCommands).values({
    id: input.id,
    ownerId,
    deviceId: input.deviceId,
    ciphertext: input.ciphertext,
    iv: input.iv,
    expiresAt: input.expiresAt,
  });
  return true;
}

export async function listPendingRemoteCommands(ownerId: string, deviceId: string) {
  const now = new Date().toISOString();
  return getDb()
    .select({
      id: remoteCommands.id,
      ciphertext: remoteCommands.ciphertext,
      iv: remoteCommands.iv,
      expiresAt: remoteCommands.expiresAt,
    })
    .from(remoteCommands)
    .where(
      and(
        eq(remoteCommands.ownerId, ownerId),
        eq(remoteCommands.deviceId, deviceId),
        eq(remoteCommands.status, "pending"),
        gt(remoteCommands.expiresAt, now),
      ),
    )
    .orderBy(asc(remoteCommands.createdAt))
    .limit(6);
}

export async function getRemoteCommand(ownerId: string, id: string) {
  const [command] = await getDb()
    .select({
      id: remoteCommands.id,
      deviceId: remoteCommands.deviceId,
      status: remoteCommands.status,
      resultCiphertext: remoteCommands.resultCiphertext,
      resultIv: remoteCommands.resultIv,
      expiresAt: remoteCommands.expiresAt,
    })
    .from(remoteCommands)
    .where(and(eq(remoteCommands.ownerId, ownerId), eq(remoteCommands.id, id)))
    .limit(1);
  return command ?? null;
}

export async function completeRemoteCommand(
  ownerId: string,
  input: { id: string; deviceId: string; resultCiphertext: string; resultIv: string },
) {
  const result = await getDb()
    .update(remoteCommands)
    .set({
      status: "completed",
      resultCiphertext: input.resultCiphertext,
      resultIv: input.resultIv,
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(remoteCommands.ownerId, ownerId),
        eq(remoteCommands.deviceId, input.deviceId),
        eq(remoteCommands.id, input.id),
        eq(remoteCommands.status, "pending"),
      ),
    );
  return Number(result.meta.changes ?? 0) > 0;
}
