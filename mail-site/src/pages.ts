import { escapeHtml } from "./util.ts";

// The same quiet paper-on-a-desk look as Vox Flash Cards, without the web
// font: a few plain pages for signing in, connecting Gmail, and approving apps.

const baseStyles = `
  :root {
    color-scheme: light;
    --desk: #e3e8ee;
    --paper: #ffffff;
    --rule: #cfe0f2;
    --margin: #db4b3f;
    --ink: #1e2b45;
    --ink-soft: #55617a;
    --ink-faint: #8a94a8;
    --action: #2f55b5;
    --action-ink: #ffffff;
    --heading: #1e2b45;
    --chip: rgb(30 43 69 / 6%);
    --danger: #c8453a;
    --ok: #2f7d4f;
    --shadow: 0 1px 1px rgb(30 43 69 / 8%), 0 8px 24px -12px rgb(30 43 69 / 28%);
    --ui: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --desk: #172233;
      --paper: #eef0ec;
      --ink-soft: #b9c3d4;
      --ink-faint: #8391a8;
      --action: #8fb0ff;
      --action-ink: #0f1a33;
      --heading: #f1f3f7;
      --shadow: 0 1px 1px rgb(0 0 0 / 30%), 0 12px 28px -12px rgb(0 0 0 / 60%);
    }
  }
  * { box-sizing: border-box; }
  html, body { background: var(--desk); }
  body { margin: 0; min-height: 100vh; font: 16px/1.55 var(--ui); color: var(--ink-soft); -webkit-font-smoothing: antialiased; }
  a { color: var(--action); }
  button { font: inherit; }
  :focus-visible { outline: 3px solid var(--action); outline-offset: 2px; }

  .solo { width: min(100% - 32px, 520px); margin: 8vh auto 48px; }
  .topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
  .wordmark { display: flex; align-items: center; gap: 10px; color: var(--ink-soft); font-weight: 600; text-decoration: none; }
  .wordmark-mark { position: relative; width: 26px; height: 19px; border-radius: 3px; background: var(--paper); box-shadow: var(--shadow); overflow: hidden; }
  /* An envelope flap. */
  .wordmark-mark::before { content: ""; position: absolute; left: 50%; top: -9px; width: 16px; height: 16px; border-right: 2px solid var(--margin); border-bottom: 2px solid var(--margin); transform: translateX(-50%) rotate(45deg); }

  .card { position: relative; margin-bottom: 18px; padding: 58px 28px 26px; background: var(--paper); border-radius: 6px; box-shadow: var(--shadow); color: var(--ink);
    background-image: linear-gradient(var(--margin), var(--margin)); background-size: 100% 2px; background-position: 0 44px; background-repeat: no-repeat; }
  .card-label { position: absolute; top: 14px; left: 28px; right: 28px; font-size: 13px; color: #8a94a8; }
  .card h1 { margin: 0 0 10px; font-size: 26px; line-height: 1.2; color: var(--ink); }
  .card p, .card li { margin: 0; color: #4a5670; }
  .card p + p { margin-top: 10px; }
  .card ul { margin: 8px 0 0; padding-left: 20px; }
  .address { font-size: 20px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
  .status { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
  .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .status.ok { color: var(--ok); }
  .status.off { color: var(--danger); }
  .actions { display: grid; gap: 10px; margin-top: 22px; }
  .actions.row { display: flex; flex-wrap: wrap; }
  form { margin: 0; }

  .button { display: inline-flex; width: 100%; white-space: nowrap; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 10px; font-weight: 600; text-decoration: none; cursor: pointer; }
  .button-primary { color: var(--action-ink); background: var(--action); }
  @media (prefers-color-scheme: dark) { .card .button-primary { color: #fff; background: #2f55b5; } }
  .button-quiet { color: #55617a; background: transparent; box-shadow: inset 0 0 0 1.5px rgb(85 97 122 / 35%); }
  .button:disabled { opacity: 0.45; cursor: default; }
  .link-button { padding: 4px 6px; border: 0; background: none; color: var(--ink-soft); cursor: pointer; text-decoration: underline; text-decoration-color: rgb(127 127 127 / 45%); text-underline-offset: 3px; }
  .card .link-button { color: #55617a; }
  .link-button.danger, .card .link-button.danger { color: var(--danger); }
  .error { color: var(--danger); min-height: 1.5em; margin-top: 10px !important; }

  .apps { margin: 10px 0 0; padding: 0; list-style: none; }
  .apps li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgb(138 148 168 / 25%); }
  .apps small { display: block; color: #8a94a8; font-size: 13px; }
  .url { display: block; margin-top: 8px; padding: 10px 12px; overflow-wrap: anywhere; border-radius: 8px; background: rgb(30 43 69 / 6%); color: #4a5670; font-size: 14px; }
  .muted { font-size: 14px; color: #8a94a8 !important; }
  .choices { display: grid; gap: 10px; margin-top: 16px; }
  .choice { display: block; padding: 14px 16px; border-radius: 10px; background: rgb(30 43 69 / 5%); color: var(--ink); text-decoration: none; }
  .choice b { display: block; }
  .choice span { font-size: 14px; color: #55617a; }
  .choice:hover { background: rgb(47 85 181 / 10%); }
  .accounts li { align-items: flex-start; }
  .accounts .row-actions { display: flex; flex-wrap: wrap; gap: 2px; justify-content: flex-end; }
  label.field-label { display: block; margin: 14px 0 4px; font-size: 14px; font-weight: 600; color: #4a5670; }
  .input, select.input { width: 100%; min-height: 44px; padding: 8px 12px; border: 1.5px solid rgb(138 148 168 / 55%); border-radius: 8px; background: #fff; color: var(--ink); font: inherit; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
  @media (max-width: 480px) { .grid-2 { grid-template-columns: 1fr; } }
  .help { margin-top: 10px !important; padding: 10px 12px; border-radius: 8px; background: rgb(47 85 181 / 8%); font-size: 14px; }
  details.advanced { margin-top: 14px; }
  details.advanced summary { cursor: pointer; font-weight: 600; color: #4a5670; }
  .check { display: flex; gap: 8px; align-items: center; margin-top: 14px; font-size: 14px; color: #4a5670; }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

function shell(title: string, body: string, script = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#e3e8ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#172233" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(title)}</title>
<style>${baseStyles}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

const wordmark = `<a class="wordmark" href="/"><span class="wordmark-mark" aria-hidden="true"></span>Vox Mail</a>`;

export function messagePage(title: string, message: string, link?: { href: string; label: string }) {
  return shell(
    title,
    `<main class="solo">
  <div class="topline">${wordmark}</div>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${link ? `<div class="actions"><a class="button button-primary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></div>` : ""}
  </div>
</main>`,
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function hidden(name: string, value: string | null | undefined) {
  return value ? `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">` : "";
}

/** Signed out: one button. */
export function signedOutPage() {
  return shell(
    "Vox Mail",
    `<main class="solo">
  <div class="topline">${wordmark}</div>
  <div class="card">
    <span class="card-label">Vox Mail</span>
    <h1>Sign in</h1>
    <p>Sign in with your Vox account to connect your email to Vox.</p>
    <div class="actions"><a class="button button-primary" href="/auth/login">Sign in with Vox</a></div>
  </div>
</main>`,
  );
}

export type AccountRow = { id: string; email: string; label: string; status: string; isPrimary: boolean; connectedAt: string; reconnectHref: string };

export type HomeState = {
  userName: string;
  accounts: AccountRow[];
  canAdd: boolean;
  apps: Array<{ grantId: string; name: string; connectedAt: string; lastUsedAt: string | null }>;
  mcpUrl: string;
};

function postButton(action: string, fields: Record<string, string>, label: string, className = "link-button") {
  return `<form method="post" action="${escapeHtml(action)}">${Object.entries(fields).map(([name, value]) => hidden(name, value)).join("")}<button class="${className}" type="submit">${escapeHtml(label)}</button></form>`;
}

/** The signed-in home page: the connected email accounts and the apps that use them. */
export function homePage(state: HomeState) {
  const accounts = state.accounts.length
    ? `<ul class="apps accounts">${state.accounts
        .map(
          (account) => `<li><span><b class="address" style="font-size:17px">${escapeHtml(account.email)}</b><small>${escapeHtml(account.label)} · ${
            account.status === "connected" ? `<span class="status ok">Connected</span>` : `<span class="status off">Needs reconnecting</span>`
          }${account.isPrimary ? " · primary: sends by default" : ""}</small></span>
        <span class="row-actions">${account.status === "connected" ? "" : `<a class="link-button" href="${escapeHtml(account.reconnectHref)}">Reconnect</a>`}${
          account.isPrimary || account.status !== "connected" ? "" : postButton("/accounts/primary", { account_id: account.id }, "Make primary")
        }${postButton("/accounts/remove", { account_id: account.id }, "Remove", "link-button danger")}</span></li>`,
        )
        .join("")}</ul>`
    : `<p><span class="status off">No email connected yet</span></p><p>Vox will be able to search, read, draft, send, label, and trash your email. It asks you before sending or trashing anything.</p>`;
  const apps = state.apps.length
    ? `<ul class="apps">${state.apps
        .map(
          (app) => `<li><span>${escapeHtml(app.name)}<small>Connected ${escapeHtml(formatDate(app.connectedAt))}${
            app.lastUsedAt ? ` · last used ${escapeHtml(formatDate(app.lastUsedAt))}` : ""
          }</small></span>
        ${postButton("/apps/disconnect", { grant_id: app.grantId }, "Disconnect", "link-button danger")}</li>`,
        )
        .join("")}</ul>`
    : `<p>No apps yet. Connect Vox Mail from Vox, or add this MCP server to another app:</p>`;
  return shell(
    "Vox Mail",
    `<main class="solo">
  <div class="topline">
    ${wordmark}
    <form method="post" action="/auth/logout"><span class="muted">${escapeHtml(state.userName)}</span> <button class="link-button" type="submit">Sign out</button></form>
  </div>
  <section class="card"><span class="card-label">Mailboxes</span>
    <h1>Email accounts</h1>
    ${accounts}
    ${state.canAdd ? `<div class="actions"><a class="button ${state.accounts.length ? "button-quiet" : "button-primary"}" href="/accounts/add">Add an email account</a></div>` : `<p class="muted">Email accounts can’t be connected yet: this site isn’t configured.</p>`}
  </section>
  <section class="card"><span class="card-label">Apps using your mail</span>
    <h1>Connected apps</h1>
    ${apps}
    <code class="url">${escapeHtml(state.mcpUrl)}</code>
  </section>
</main>`,
  );
}

/** Google, Microsoft, or another provider; only the configured ones. */
export function addAccountPage(input: { google: boolean; microsoft: boolean; imap: boolean; nonce: string | null }) {
  const query = input.nonce ? `?r=${encodeURIComponent(input.nonce)}` : "";
  const choices = [
    input.google ? `<a class="choice" href="/google/connect${query}"><b>Google</b><span>Gmail and Google Workspace. Sign in with Google.</span></a>` : "",
    input.microsoft ? `<a class="choice" href="/microsoft/connect${query}"><b>Microsoft</b><span>Outlook.com, Hotmail, Live, and Microsoft 365. Sign in with Microsoft.</span></a>` : "",
    input.imap ? `<a class="choice" href="/imap/connect${query}"><b>Other (IMAP)</b><span>iCloud, Yahoo, Fastmail, Zoho, and other providers, with an app password.</span></a>` : "",
  ].join("");
  return shell(
    "Add an email account",
    `<main class="solo">
  <div class="topline">${wordmark}</div>
  <div class="card">
    <span class="card-label">Add an email account</span>
    <h1>Which email?</h1>
    ${choices ? `<div class="choices">${choices}</div>` : `<p>No email providers are configured on this site yet.</p>`}
    <div class="actions"><a class="button button-quiet" href="/">Cancel</a></div>
  </div>
</main>`,
  );
}

export type ImapFormValues = {
  email?: string;
  preset?: string;
  username?: string;
  imapHost?: string;
  imapPort?: string;
  imapSecurity?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpSecurity?: string;
  saveSent?: boolean;
};

/** The IMAP form. The password field always starts empty. */
export function imapPage(input: {
  presets: Record<string, { name: string; help: string; imapHost: string; imapPort: number; imapSecurity: string; smtpHost: string; smtpPort: number; smtpSecurity: string; saveSent: boolean }>;
  values: ImapFormValues;
  error?: string;
  nonce: string | null;
  microsoft: boolean;
}) {
  const values = input.values;
  const preset = values.preset && (values.preset === "custom" || input.presets[values.preset]) ? values.preset : "icloud";
  const option = (value: string, label: string, current: string | undefined) => `<option value="${value}"${current === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const data = JSON.stringify({ presets: input.presets }).replace(/</g, "\\u003c");
  return shell(
    "Add an IMAP account",
    `<main class="solo">
  <div class="topline">${wordmark}</div>
  <form class="card" method="post" action="/imap/connect" autocomplete="off">
    <span class="card-label">Other email (IMAP)</span>
    <h1>Add an email account</h1>
    <p>Use an <b>app password</b>, not your normal password. Vox Mail checks it with your provider before saving it, encrypted.</p>
    ${input.microsoft ? `<p class="muted">Outlook.com and Hotmail addresses connect with <a href="/microsoft/connect${input.nonce ? `?r=${encodeURIComponent(input.nonce)}` : ""}">Sign in with Microsoft</a> instead.</p>` : ""}
    ${hidden("r", input.nonce)}
    <label class="field-label" for="preset">Provider</label>
    <select class="input" id="preset" name="preset">
      ${Object.entries(input.presets).map(([key, item]) => option(key, item.name, preset)).join("")}
      ${option("custom", "Other (enter servers)", preset)}
    </select>
    <p class="help" id="help"></p>
    <label class="field-label" for="email">Email address</label>
    <input class="input" id="email" name="email" type="email" required maxlength="254" value="${escapeHtml(values.email ?? "")}" autocomplete="username">
    <label class="field-label" for="password">App password</label>
    <input class="input" id="password" name="password" type="password" required maxlength="200" autocomplete="new-password">
    <details class="advanced" id="advanced"${preset === "custom" ? " open" : ""}>
      <summary>Server settings</summary>
      <label class="field-label" for="username">User name (if not the email address)</label>
      <input class="input" id="username" name="username" maxlength="254" value="${escapeHtml(values.username ?? "")}">
      <div class="grid-2">
        <div><label class="field-label" for="imap_host">IMAP server</label><input class="input" id="imap_host" name="imap_host" maxlength="253" value="${escapeHtml(values.imapHost ?? "")}"></div>
        <div><label class="field-label" for="imap_port">IMAP port</label><select class="input" id="imap_port" name="imap_port">${option("993", "993 (SSL/TLS)", values.imapPort ?? "993")}${option("143", "143 (STARTTLS)", values.imapPort)}</select></div>
        <div><label class="field-label" for="smtp_host">SMTP server</label><input class="input" id="smtp_host" name="smtp_host" maxlength="253" value="${escapeHtml(values.smtpHost ?? "")}"></div>
        <div><label class="field-label" for="smtp_port">SMTP port</label><select class="input" id="smtp_port" name="smtp_port">${option("465", "465 (SSL/TLS)", values.smtpPort ?? "465")}${option("587", "587 (STARTTLS)", values.smtpPort)}</select></div>
      </div>
      <label class="check"><input type="checkbox" name="save_sent" value="1"${values.saveSent === false ? "" : " checked"}> Save a copy of sent mail in the Sent folder</label>
    </details>
    <p class="error" role="alert">${escapeHtml(input.error ?? "")}</p>
    <div class="actions">
      <button class="button button-primary" type="submit">Check and add</button>
      <a class="button button-quiet" href="/accounts/add${input.nonce ? `?r=${encodeURIComponent(input.nonce)}` : ""}">Back</a>
    </div>
  </form>
</main>
<script type="application/json" id="presets">${data}</script>`,
    `(() => {
  const { presets } = JSON.parse(document.getElementById("presets").textContent);
  const $ = (id) => document.getElementById(id);
  function show() {
    const preset = presets[$("preset").value];
    $("help").textContent = preset ? preset.help : "Enter your provider's IMAP and SMTP servers. Most providers list them in their help pages under \u201cIMAP settings\u201d.";
    $("help").hidden = false;
    if (preset) {
      $("imap_host").value = preset.imapHost;
      $("imap_port").value = String(preset.imapPort);
      $("smtp_host").value = preset.smtpHost;
      $("smtp_port").value = String(preset.smtpPort);
    } else {
      $("advanced").open = true;
    }
  }
  $("preset").addEventListener("change", show);
  show();
})();`,
  );
}

/** Approval screen shown to a signed-in user when an MCP client asks for access. */
export function consentPage(input: { clientName: string; userName: string; accounts: string[]; returnHost: string; query: string }) {
  const name = escapeHtml(input.clientName);
  const data = JSON.stringify({ query: input.query }).replace(/</g, "\\u003c");
  return shell(
    `Allow ${input.clientName}?`,
    `<main class="solo">
  <div class="topline">${wordmark}</div>
  <div class="card">
    <h1>Allow ${name} to use your email?</h1>
    <p>You’re signed in as ${escapeHtml(input.userName)}, with ${input.accounts.map((email) => `<b>${escapeHtml(email)}</b>`).join(", ")}. ${name} will be able to:</p>
    <ul>
      <li>search and read your email</li>
      <li>write drafts, and send, reply, and forward</li>
      <li>archive, label, mark read, and move to Trash</li>
    </ul>
    <p style="margin-top:10px">This covers email accounts you add later too. You can disconnect it anytime on this site. Next you’ll return to ${escapeHtml(input.returnHost)}.</p>
    <div class="actions">
      <button class="button button-primary" id="allow" type="button">Allow</button>
      <button class="button button-quiet" id="deny" type="button">Cancel</button>
    </div>
    <p class="error" id="error" role="alert"></p>
  </div>
</main>
<script type="application/json" id="request">${data}</script>`,
    `(() => {
  const { query } = JSON.parse(document.getElementById("request").textContent);
  async function decide(approve) {
    for (const button of document.querySelectorAll("button")) button.disabled = true;
    try {
      const response = await fetch("/oauth/authorize?" + query, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.redirect) throw new Error(result.error || "Connecting didn’t finish. Try again from the app.");
      window.location.replace(result.redirect);
    } catch (failure) {
      document.getElementById("error").textContent = failure.message;
      for (const button of document.querySelectorAll("button")) button.disabled = false;
    }
  }
  document.getElementById("allow").addEventListener("click", () => decide(true));
  document.getElementById("deny").addEventListener("click", () => decide(false));
})();`,
  );
}
