import assert from "node:assert/strict";

import {
  enforceLocalCapabilityRoute,
  locallyAuthorizedVisionNeed,
} from "../lib/local-capability-policy.ts";

const noLocalEvidence = {
  desktopAvailable: true,
  desktopControlDetected: false,
  localCodexRequested: false,
  openWorkspaceRequested: false,
};

for (const route of ["desktop_action", "desktop_control", "local_codex", "smart_home"]) {
  assert.equal(
    enforceLocalCapabilityRoute(route, noLocalEvidence),
    "realtime",
    `Cloud route ${route} must not create local authority`,
  );
}

assert.equal(
  enforceLocalCapabilityRoute("desktop_action", {
    ...noLocalEvidence,
    openWorkspaceRequested: true,
  }),
  "desktop_action",
);
assert.equal(
  enforceLocalCapabilityRoute("desktop_control", {
    ...noLocalEvidence,
    desktopControlDetected: true,
  }),
  "desktop_control",
);
assert.equal(
  enforceLocalCapabilityRoute("local_codex", {
    ...noLocalEvidence,
    localCodexRequested: true,
  }),
  "local_codex",
);
assert.equal(
  enforceLocalCapabilityRoute("desktop_control", {
    ...noLocalEvidence,
    desktopAvailable: false,
  }),
  "desktop_control",
);

assert.equal(locallyAuthorizedVisionNeed("I bought a new camera", "inspect_high"), "none");
assert.equal(locallyAuthorizedVisionNeed("Can you look at this?", "inspect_high"), "inspect_low");
assert.equal(
  locallyAuthorizedVisionNeed("Please read the small text on this label", "inspect_high"),
  "inspect_high",
);

console.log("Local capability authority checks passed.");
