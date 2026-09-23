import {
  fallbackVisionNeed,
  parseVisionNeed,
  type VisionNeed,
} from "./vision.ts";

type LocalCapabilityEvidence = {
  desktopAvailable: boolean;
  desktopControlDetected: boolean;
  localCodexRequested: boolean;
  openWorkspaceRequested: boolean;
};

/**
 * Cloud output may prioritize a request, but it cannot manufacture the local
 * user intent required to operate this computer.
 */
export function enforceLocalCapabilityRoute<T extends string>(
  route: T,
  evidence: LocalCapabilityEvidence,
): T | "realtime" {
  if (!evidence.desktopAvailable) return route;
  if (route === "desktop_action" && !evidence.openWorkspaceRequested) return "realtime";
  if (route === "desktop_control" && !evidence.desktopControlDetected) return "realtime";
  if (route === "local_codex" && !evidence.localCodexRequested) return "realtime";
  // Smart-home intent is parsed and executed locally before cloud routing.
  if (route === "smart_home") return "realtime";
  return route;
}

/** A server response cannot capture or increase the detail of a camera frame. */
export function locallyAuthorizedVisionNeed(
  text: string,
  routedNeed: unknown,
): VisionNeed {
  const localNeed = fallbackVisionNeed(text);
  if (localNeed === "none" || localNeed === "inspect_low") return localNeed;
  const parsedRoute = parseVisionNeed(routedNeed);
  return parsedRoute === "none" ? localNeed : parsedRoute;
}
