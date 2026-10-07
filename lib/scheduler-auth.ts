// Routes that only the Worker's cron handler may call. The handler
// (cloudflare/worker-entry.mjs) mints a token inside the running isolate and
// sends it in-process; it never travels over the network, so no outside
// request can present it.
export function schedulerAuthorized(request: Request) {
  const expected = (globalThis as { __voxSchedulerToken?: unknown }).__voxSchedulerToken;
  const received = request.headers.get("x-vox-scheduler") ?? "";
  if (typeof expected !== "string" || expected.length < 32) return false;
  let difference = expected.length ^ received.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ (received.charCodeAt(index) || 0);
  }
  return difference === 0;
}
