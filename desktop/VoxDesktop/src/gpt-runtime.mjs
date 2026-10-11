import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const GPT_MODEL = "gpt-6.1-sol";
export const GPT_REASONING = "high";

/** Subscription authentication; a key inherited by Electron must not change billing. */
export function chatGptEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => ![
    "OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID",
  ].includes(key)));
}

export async function gptEnvironment(codexPath, env = process.env) {
  if (typeof codexPath !== "string" || !codexPath) throw new Error("The local Codex runtime is unavailable on this device.");
  const result = chatGptEnvironment(env);
  for (const directory of [
    path.dirname(codexPath),
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin",
    "/Applications/Codex.app/Contents/Resources/codex-cli/bin",
  ]) {
    try {
      await access(path.join(directory, "codex-code-mode-host"), constants.X_OK);
      result.PATH = `${directory}${path.delimiter}${result.PATH ?? ""}`;
      return result;
    } catch { /* Try the next installed runtime. */ }
  }
  throw new Error("Live GPT tools need the Code Mode host. Install or update the ChatGPT desktop app.");
}

/** A task-specific SDK executable, with no inherited plugins, MCP servers or rules. */
export async function isolatedGptRuntime(codexPath) {
  const directory = await mkdtemp(path.join(tmpdir(), "vox-gpt-"));
  try {
    const executable = path.join(directory, "codex");
    const quoted = `'${codexPath.replaceAll("'", "'\\''")}'`;
    await writeFile(executable, `#!/bin/sh\nexec ${quoted} "$@" --ignore-user-config --ignore-rules --ephemeral\n`);
    await chmod(executable, 0o700);
    return { directory, executable, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
