import { count, eq } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import { activationCodes } from "../db/schema.ts";
import { hashAccessCode, type AuthenticatedUser } from "./auth.ts";

export type InviteStatus = {
  generated: number;
  unlimited: boolean;
  canGenerate: boolean;
};

function newActivationCode() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `VOX-${token.slice(0, 8)}-${token.slice(8, 16)}-${token.slice(16, 24)}-${token.slice(24)}`;
}

export async function getInviteStatus(user: AuthenticatedUser): Promise<InviteStatus> {
  const [result] = await getDb()
    .select({ value: count() })
    .from(activationCodes)
    .where(eq(activationCodes.createdBy, user.id));
  const generated = result?.value ?? 0;
  const unlimited = user.role === "master";
  return { generated, unlimited, canGenerate: unlimited || generated === 0 };
}

export async function createInviteCode(
  user: AuthenticatedUser,
  requestedName?: string,
) {
  const status = await getInviteStatus(user);
  if (!status.canGenerate) {
    throw new Error("INVITE_LIMIT_REACHED");
  }

  const id = crypto.randomUUID();
  const code = newActivationCode();
  const codeHash = await hashAccessCode(code);
  const displayName = requestedName?.trim().slice(0, 80) || "Vox member";

  try {
    await getDb().insert(activationCodes).values({
      id,
      userId: id,
      codeHash,
      displayName,
      createdBy: user.id,
      creatorSlot: user.role === "master" ? `master:${id}` : user.id,
    });
  } catch (error) {
    if (user.role !== "master") throw new Error("INVITE_LIMIT_REACHED");
    throw error;
  }

  return {
    code,
    displayName,
    status: {
      generated: status.generated + 1,
      unlimited: status.unlimited,
      canGenerate: status.unlimited,
    } satisfies InviteStatus,
  };
}
