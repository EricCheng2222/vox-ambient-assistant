import type { ApnsDevice, ApnsNote, ApnsResult } from "./apns.ts";

// Reaching the owner when Vox is closed. Every message is left as a notice
// for the owner's iPhone and iPad to collect and show as a notification, and
// is also delivered right away when that is possible: a push (needs a paid
// Apple developer account) or, failing that, a text to their own number.

export type ReachResult = { ok: true } | { ok: false; error: string };

/** A message as a notification: its first short line is the title, a link-only last line is left off (tapping opens Vox). */
export function pushParts(text: string): ApnsNote {
  const lines = text.trim().split("\n");
  while (lines.length > 1 && /^https?:\/\/\S+$/u.test(lines[lines.length - 1].trim())) lines.pop();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const first = (lines[0] ?? "").trim();
  if (lines.length > 1 && first.length > 0 && first.length <= 60) {
    return { title: first, body: lines.slice(1).join("\n").trim() };
  }
  return { title: "Vox", body: lines.join("\n").trim() };
}

export function createOwnerReacher(deps: {
  /** Devices Apple can push to (none without a push key). */
  devicesFor(ownerId: string): Promise<ApnsDevice[]>;
  forgetDevice(token: string): Promise<void>;
  sendToDevice(device: ApnsDevice, note: ApnsNote): Promise<ApnsResult>;
  /** A text to the owner's own number. */
  text(ownerId: string, body: string): Promise<ReachResult>;
  /** Leaves the notice for the owner's devices to collect; resolves to how many devices collect notices. */
  leaveNotice(ownerId: string, note: ApnsNote, delivered: boolean): Promise<number>;
}) {
  return async function reachOwner(ownerId: string, body: string): Promise<ReachResult> {
    const note = pushParts(body);
    let pushed = false;
    const devices = await deps.devicesFor(ownerId).catch((): ApnsDevice[] => []);
    if (devices.length) {
      const results = await Promise.all(devices.map((device) => deps.sendToDevice(device, note).catch((): ApnsResult => ({ ok: false, error: "unreachable", gone: false }))));
      await Promise.all(results.map((result, index) => (!result.ok && result.gone ? deps.forgetDevice(devices[index].token).catch(() => undefined) : undefined)));
      pushed = results.some((result) => result.ok);
    }
    const texted: ReachResult = pushed ? { ok: true } : await deps.text(ownerId, body).catch((): ReachResult => ({ ok: false, error: "unreachable" }));
    const collectors = await deps.leaveNotice(ownerId, note, texted.ok).catch(() => 0);
    // Not delivered now, but a device will collect it: that still counts as sent.
    return texted.ok || collectors > 0 ? { ok: true } : texted;
  };
}
