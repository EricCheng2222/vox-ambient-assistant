import { requireUser } from "@/lib/auth";
import type { StagePage } from "@/lib/stage";
import { fetchStagePage, StagePageError, validateStageUrl } from "@/lib/stage-extract";

// A readable version of a public web page for the stage's reader view. The
// server fetches the page (public hosts only, redirects re-checked, 8 s, 2 MB,
// HTML only) and keeps the extraction for ten minutes. Pages are public, so
// the cache is shared between users.

const CACHE_SECONDS = 600;
const CACHE_ORIGIN = "https://stage-page.vox.invalid";

function edgeCache(): Cache | null {
  try {
    return (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

function cacheKey(url: string) {
  return new Request(`${CACHE_ORIGIN}/?url=${encodeURIComponent(url)}`, { method: "GET" });
}

function pageResponse(page: StagePage) {
  return Response.json(page, { headers: { "Cache-Control": `private, max-age=${CACHE_SECONDS}` } });
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const checked = validateStageUrl(raw);
  if (!checked.ok) {
    return Response.json({ error: checked.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (checked.url.host === new URL(request.url).host) {
    return Response.json({ error: "That address is not a public web page." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const target = checked.url.toString();

  const cache = edgeCache();
  const key = cacheKey(target);
  const cached = await cache?.match(key).catch(() => undefined);
  if (cached) {
    const page = (await cached.json().catch(() => null)) as StagePage | null;
    if (page) return pageResponse(page);
  }

  try {
    const page = await fetchStagePage(target);
    await cache
      ?.put(key, Response.json(page, { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } }))
      .catch(() => undefined);
    return pageResponse(page);
  } catch (error) {
    const known = error instanceof StagePageError;
    if (!known) console.error("Stage page failed", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { error: known ? error.message : "That page could not be loaded." },
      { status: known ? error.status : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
