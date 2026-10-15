import { escapeHtml } from "./util.ts";
import { appleSiteStyles } from "../../lib/apple-site.ts";

const siteStyles = `${appleSiteStyles}
  .mail-home { max-width: 64rem; }
  .mail-home .figures { grid-template-columns: minmax(0, 0.7fr) minmax(0, 0.7fr) minmax(0, 1.6fr); }
  .mail-home .row[data-state="attention"] { background: color-mix(in srgb, var(--warn) 5%, var(--glass)); }
  .mail-home .row-actions { max-width: 14rem; }
  .mail-home .row-meta .state:not(.amber) { color: var(--success); }
  .server-details { border-top: 1px solid var(--line-soft); }
  .server-details > summary { min-height: 2.75rem; padding: 0.75rem 1.25rem; color: var(--muted); font-size: 0.8125rem; cursor: pointer; }
  .server-details .section-foot { padding-top: 0; }
  @media (max-width: 639px) {
    .mail-home .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .mail-home .row-actions { max-width: none; }
  }
`;

function shell(title: string, body: string, script = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16161b" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(title)}</title>
<style>${siteStyles}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

// ---- Icons (inline SVG, stroked in currentColor) ----

const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  arrow: icon('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back: icon('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  shield: icon('<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  check: icon('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  mic: icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  key: icon('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>'),
  alert: icon('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
  signout: icon('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4"/>'),
};

/** The Vox Mail mark: a reactor ring around an envelope. */
function brandMark() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true">
  <defs><linearGradient id="vx-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd9b0"/><stop offset="1" stop-color="#e86a52"/></linearGradient></defs>
  <circle cx="24" cy="24" r="22" fill="#f5a25a" fill-opacity="0.2"/>
  <circle cx="24" cy="24" r="16" fill="url(#vx-sun)"/>
  <rect x="16.5" y="18.5" width="15" height="11" rx="2" fill="none" stroke="#2a1d3f" stroke-width="1.8"/><path d="M17.2 19.8l6.8 5 6.8-5" fill="none" stroke="#2a1d3f" stroke-width="1.8" stroke-linejoin="round"/>
</svg>`;
}

/** The setting sun on the landing page. */
function reactor() {
  return `<div class="reactor" aria-hidden="true"><svg viewBox="0 0 400 400">
  <defs>
    <linearGradient id="vx-big-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe0bd"/><stop offset="0.55" stop-color="#f5a25a"/><stop offset="1" stop-color="#e2574c"/></linearGradient>
    <radialGradient id="vx-glow"><stop offset="0.45" stop-color="#f5a25a" stop-opacity="0.35"/><stop offset="1" stop-color="#f5a25a" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="200" cy="200" r="196" fill="url(#vx-glow)"/>
  <circle cx="200" cy="200" r="118" fill="url(#vx-big-sun)"/>
  <!-- Going down: bands of the page background closing over the lower half,
       so the sun sets into the page in light and dark mode alike. -->
  <g style="fill: var(--night)"><rect x="70" y="232" width="260" height="6" rx="3" opacity="0.5"/><rect x="70" y="254" width="260" height="10" rx="5" opacity="0.62"/><rect x="70" y="280" width="260" height="14" rx="7" opacity="0.74"/><rect x="70" y="308" width="260" height="18" rx="9" opacity="0.86"/></g>
  <rect x="152" y="140" width="96" height="66" rx="10" fill="none" stroke="#3a2458" stroke-width="8"/><path d="M156 146l44 32 44-32" fill="none" stroke="#3a2458" stroke-width="8" stroke-linejoin="round"/>
</svg></div>`;
}

function topbar(extra = "") {
  return `<header class="topbar">
  <a class="brand" href="/">${brandMark()}<span>Vox <b>Mail</b></span></a>
  ${extra}
</header>`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function hidden(name: string, value: string | null | undefined) {
  return value ? `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">` : "";
}

export function messagePage(title: string, message: string, link?: { href: string; label: string }) {
  return shell(
    title,
    `<div class="wrap narrow">
  ${topbar()}
  <main class="panel panel-pad stack">
    <p class="hud">Notice</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">${escapeHtml(message)}</p>
    ${link ? `<div class="btn-row"><a class="btn btn-primary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></div>` : ""}
  </main>
</div>`,
  );
}

/** Signed out: what Vox does with email, the kinds of account, the safety promise, and sign-in. */
export function signedOutPage() {
  return shell(
    "Vox Mail",
    `<div class="wrap">
  ${topbar()}
  <main class="stack" style="gap:28px">
    <section class="hero">
      <div class="hero-copy">
        <p class="hud">Vox Mail</p>
        <h1>Your email, by voice.</h1>
        <p class="lede">Ask Vox what’s new, have a message read to you, and dictate replies, drafts, and tidy-ups across every inbox you connect.</p>
        <div class="cta">
          <a class="btn btn-primary" href="/auth/login">Sign in with Vox ${icons.arrow}</a>
          <span class="muted">Uses your Vox account. No new password to remember.</span>
        </div>
      </div>
      ${reactor()}
    </section>
    <section aria-label="Accounts you can connect" class="tiles">
      <div class="tile"><span class="mono">G</span><h2>Gmail</h2><p>Gmail and Google Workspace. Sign in with Google.</p></div>
      <div class="tile"><span class="mono">O</span><h2>Outlook</h2><p>Outlook.com, Hotmail, and Microsoft 365. Sign in with Microsoft.</p></div>
      <div class="tile"><span class="mono small-text">iCloud</span><h2>iCloud &amp; others</h2><p>iCloud, Yahoo, Fastmail, Zoho, or your own domain, with an app password.</p></div>
    </section>
    <section class="note" aria-label="Safety">
      ${icons.shield}
      <div><h3>Nothing is sent or deleted without your spoken yes</h3>
      <p>Before Vox sends, replies, forwards, or moves email to the Trash, it tells you who it’s going to and what it says, and waits for you to say yes.</p></div>
    </section>
  </main>
</div>`,
  );
}

export type AccountRow = {
  id: string;
  email: string;
  provider: string;
  label: string;
  status: string;
  isPrimary: boolean;
  connectedAt: string;
  reconnectHref: string;
  /** Google accounts: what was allowed beyond mail, and where to allow the rest. */
  google?: { calendar: boolean; tasks: boolean; contacts: boolean; drive: boolean; allowHref: string | null } | null;
};

export type HomeState = {
  userName: string;
  accounts: AccountRow[];
  canAdd: boolean;
  apps: Array<{ grantId: string; name: string; connectedAt: string; lastUsedAt: string | null }>;
  mcpUrl: string;
};

function postButton(action: string, fields: Record<string, string>, label: string, className = "btn btn-sm btn-quiet") {
  return `<form method="post" action="${escapeHtml(action)}">${Object.entries(fields).map(([name, value]) => hidden(name, value)).join("")}<button class="${className}" type="submit">${escapeHtml(label)}</button></form>`;
}

/** A provider monogram: G, O, iCloud, or @. */
function monogram(account: { provider: string; label: string }, big = false) {
  const size = big ? " big" : "";
  if (account.provider === "gmail") return `<span class="mono${size}" aria-hidden="true">G</span>`;
  if (account.provider === "microsoft") return `<span class="mono${size}" aria-hidden="true">O</span>`;
  if (/^iCloud/u.test(account.label)) return `<span class="mono small-text${size}" aria-hidden="true">iCloud</span>`;
  return `<span class="mono${size}" aria-hidden="true">@</span>`;
}

function signInMethod(provider: string) {
  return provider === "gmail" ? "signed in with Google" : provider === "microsoft" ? "signed in with Microsoft" : "app password";
}

function wordList(words: string[]) {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? "");
}

/** For a Google account: what Vox can use, and a button to allow whatever is missing. */
function googleAccess(account: AccountRow) {
  const google = account.google;
  if (!google) return "";
  const parts: Array<[boolean, string, string]> = [
    [google.calendar, "Calendar", "calendar"],
    [google.tasks, "Tasks", "tasks"],
    [google.contacts, "Contacts", "contacts"],
    [google.drive, "Drive", "files"],
  ];
  const allowed = ["Mail", ...parts.filter(([granted]) => granted).map(([, name]) => name)];
  const missing = parts.filter(([granted]) => !granted).map(([, , word]) => word);
  const button =
    missing.length && google.allowHref && account.status === "connected"
      ? `<div class="row-allow"><a class="btn btn-sm" href="${escapeHtml(google.allowHref)}">Allow ${wordList(missing)}</a></div>`
      : "";
  // What this account lets Vox use, at a glance: lit when allowed, faint when not.
  const uses = [["Mail", true] as const, ...parts.map(([granted, name]) => [name, granted] as const)]
    .map(([name, granted]) => `<span class="use${granted ? "" : " off"}">${name}${granted ? "" : `<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"> not allowed</span>`}</span>`)
    .join("");
  return `<div class="uses" aria-label="Vox can use ${wordList(allowed)}${allowed.length === 1 ? " only" : ""}">${uses}</div>${button}`;
}

/** The signed-in home page: the connected email accounts and the apps that use them. */
export function homePage(state: HomeState) {
  const accounts = state.accounts.length
    ? `<ul class="rows">${state.accounts
        .map((account) => {
          const ok = account.status === "connected";
          return `<li class="row" data-state="${ok ? "connected" : "attention"}">
        ${monogram(account)}
        <div class="row-main">
          <div class="row-title"><span class="address">${escapeHtml(account.email)}</span>${account.isPrimary ? `<span class="chip" title="New email goes out from here by default">Primary</span>` : ""}</div>
          <div class="row-meta"><span>${escapeHtml(account.label)} · ${signInMethod(account.provider)}</span>${
            ok ? `<span class="state"><span class="dot"></span>Connected</span>` : `<span class="state amber"><span class="dot amber"></span>Needs reconnecting</span>`
          }</div>
          ${googleAccess(account)}
        </div>
        <div class="row-actions">${ok ? "" : `<a class="btn btn-sm btn-amber" href="${escapeHtml(account.reconnectHref)}">Reconnect</a>`}${
          account.isPrimary || !ok ? "" : postButton("/accounts/primary", { account_id: account.id }, "Make primary", "btn btn-sm")
        }${postButton("/accounts/remove", { account_id: account.id }, "Remove", "btn btn-sm btn-quiet btn-danger")}</div>
      </li>`;
        })
        .join("")}</ul>`
    : `<div class="empty"><p>No email connected yet. Add Gmail, Outlook, iCloud, or any other account, and Vox can search, read, draft, send, label, and tidy it for you. With a Google account, Vox can also use your calendar, tasks, contacts, and Drive files.</p></div>`;
  const add = state.canAdd
    ? `<a class="btn ${state.accounts.length ? "" : "btn-primary"}" href="/accounts/add">${icons.plus}Add an account</a>`
    : `<p class="muted">Email accounts can’t be connected yet: this site isn’t configured.</p>`;
  const apps = state.apps.length
    ? `<ul class="rows">${state.apps
        .map(
          (app) => `<li class="row">
        <span class="mono" aria-hidden="true">${escapeHtml(app.name.trim().charAt(0).toUpperCase() || "A")}</span>
        <div class="row-main"><div class="row-title">${escapeHtml(app.name)}</div><div class="row-meta">Connected ${escapeHtml(formatDate(app.connectedAt))}${
          app.lastUsedAt ? ` · last used ${escapeHtml(formatDate(app.lastUsedAt))}` : ""
        }</div></div>
        <div class="row-actions">${postButton("/apps/disconnect", { grant_id: app.grantId }, "Disconnect", "btn btn-sm btn-quiet btn-danger")}</div>
      </li>`,
        )
        .join("")}</ul>`
    : `<div class="empty"><p>No apps yet. Connect Vox Mail from Vox, or add this MCP server to another app.</p></div>`;
  // The whole set-up in four figures, before the detail.
  const attention = state.accounts.filter((account) => account.status !== "connected").length;
  const primary = state.accounts.find((account) => account.isPrimary);
  const lastUsed = state.apps.map((app) => app.lastUsedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const figures = state.accounts.length
    ? `<section class="figures" aria-label="At a glance">
      <div class="figure"><span class="figure-label">Mailboxes</span><span class="figure-value">${state.accounts.length}</span><span class="figure-note${attention ? " warn" : ""}">${attention ? `${attention} ${attention === 1 ? "needs" : "need"} reconnecting` : "all connected"}</span></div>
      <div class="figure"><span class="figure-label">Apps with access</span><span class="figure-value">${state.apps.length}</span><span class="figure-note">${lastUsed ? `last used ${escapeHtml(formatDate(lastUsed))}` : state.apps.length ? "not used yet" : "none connected"}</span></div>
      <div class="figure wide"><span class="figure-label">New email goes out from</span><span class="figure-value" style="font-size:17px;line-height:1.35;letter-spacing:0;overflow-wrap:anywhere">${primary ? escapeHtml(primary.email) : "No primary yet"}</span><span class="figure-note">${primary ? escapeHtml(primary.label) : "choose one below"}</span></div>
    </section>`
    : "";
  return shell(
    "Vox Mail",
    `<div class="wrap mail-home">
  ${topbar(`<form class="who" method="post" action="/auth/logout"><span class="who-name">${escapeHtml(state.userName)}</span><button class="btn btn-sm btn-quiet" type="submit">${icons.signout}Sign out</button></form>`)}
  <main class="stack" style="gap:22px">
    <div class="page-head">
      <p class="hud">Vox Mail</p>
      <h1>Email accounts</h1>
      <p class="lede">Manage the accounts Vox uses to read and write your email. Choose a primary account for new messages.</p>
    </div>
    ${figures}
    <section class="panel" aria-labelledby="accounts-title">
      <div class="panel-head"><h2 id="accounts-title">Mailboxes</h2>${state.accounts.length ? add : ""}</div>
      ${accounts}
      ${state.accounts.length ? "" : `<div class="section-foot">${add}</div>`}
    </section>
    <section class="note" aria-label="Safety">
      ${icons.shield}
      <div><h3>Nothing leaves without your spoken yes</h3>
      <p>Before Vox sends, replies, forwards, or trashes email, it reads back who it’s going to and what it says, and waits for you. The same goes for inviting people to an event, deleting an event or a task, and moving a Drive file to the trash.</p></div>
    </section>
    <section class="panel" aria-labelledby="apps-title">
      <div class="panel-head"><h2 id="apps-title">Connected apps</h2></div>
      ${apps}
      <details class="server-details"><summary>Connect another app</summary><div class="section-foot"><span class="hud">MCP server address</span><code class="code">${escapeHtml(state.mcpUrl)}</code></div></details>
    </section>
  </main>
</div>`,
  );
}

/** Google, Microsoft, or another provider; only the configured ones. */
export function addAccountPage(input: { google: boolean; microsoft: boolean; imap: boolean; nonce: string | null }) {
  const query = input.nonce ? `?r=${encodeURIComponent(input.nonce)}` : "";
  const tile = (href: string, mark: string, title: string, text: string, action: string) =>
    `<a class="tile" href="${href}">${mark}<h2>${title}</h2><p>${text}</p><span class="tile-foot">${action}${icons.arrow}</span></a>`;
  const choices = [
    input.google ? tile(`/google/connect${query}`, `<span class="mono big">G</span>`, "Google", "Gmail and Google Workspace, with your calendar, tasks, contacts, and Drive files. Sign in with Google.", "Sign in with Google") : "",
    input.microsoft
      ? tile(`/microsoft/connect${query}`, `<span class="mono big">O</span>`, "Microsoft", "Outlook.com, Hotmail, Microsoft 365. Sign in with Microsoft.", "Sign in with Microsoft")
      : "",
    input.imap ? tile(`/imap/connect${query}`, `<span class="mono big">@</span>`, "Other (IMAP)", "iCloud, Yahoo, Fastmail, Zoho, your own domain. Use an app password.", "Use an app password") : "",
  ].join("");
  return shell(
    "Add an email account",
    `<div class="wrap" style="width:min(100% - 32px, 960px)">
  ${topbar()}
  <main class="stack" style="gap:24px">
    <div class="page-head">
      <p class="hud">Add an account</p>
      <h1>Add an email account</h1>
      <p class="lede">Pick where your email lives. You can add as many accounts as you like.</p>
    </div>
    ${choices ? `<div class="tiles">${choices}</div>` : `<p class="lede">No email providers are configured on this site yet.</p>`}
    <div><a class="btn btn-quiet" href="/">${icons.back}Cancel</a></div>
  </main>
</div>`,
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

type PresetInfo = {
  name: string;
  help: string;
  steps: string[];
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  saveSent: boolean;
};

const CUSTOM_STEPS = [
  "Search your provider’s help pages for “app password” and “IMAP settings”.",
  "If your account uses two-step sign-in, create an app password there. Otherwise your normal password may work.",
  "Open Server settings and enter the IMAP and SMTP servers they list.",
];

/** The IMAP form, with an explainer of app passwords beside it. The password field always starts empty. */
export function imapPage(input: { presets: Record<string, PresetInfo>; values: ImapFormValues; error?: string; nonce: string | null; microsoft: boolean }) {
  const values = input.values;
  const preset = values.preset && (values.preset === "custom" || input.presets[values.preset]) ? values.preset : "icloud";
  const option = (value: string, label: string, current: string | undefined) => `<option value="${value}"${current === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const data = JSON.stringify({ presets: input.presets, custom: CUSTOM_STEPS }).replace(/</g, "\\u003c");
  const current = input.presets[preset];
  const steps = (current?.steps ?? CUSTOM_STEPS).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  const back = `/accounts/add${input.nonce ? `?r=${encodeURIComponent(input.nonce)}` : ""}`;
  return shell(
    "Add an IMAP account",
    `<div class="wrap" style="width:min(100% - 32px, 1040px)">
  ${topbar()}
  <main class="stack" style="gap:24px">
    <div class="page-head">
      <p class="hud">Add an account</p>
      <h1>Connect with an app password</h1>
      <p class="lede">For iCloud, Yahoo, Fastmail, Zoho, and most other providers. Vox Mail checks the password with your provider before saving it, encrypted.</p>
    </div>
    <div class="with-aside" style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.9fr);gap:20px;align-items:start">
      <form class="panel panel-pad" method="post" action="/imap/connect" autocomplete="off">
        ${hidden("r", input.nonce)}
        <p class="hud">Account</p>
        ${input.microsoft ? `<p class="muted" style="margin-top:10px;font-size:14px">Outlook.com and Hotmail addresses connect with <a href="/microsoft/connect${input.nonce ? `?r=${encodeURIComponent(input.nonce)}` : ""}">Sign in with Microsoft</a> instead.</p>` : ""}
        <label class="field-label" for="preset">Provider</label>
        <select class="input" id="preset" name="preset">
          ${Object.entries(input.presets).map(([key, item]) => option(key, item.name, preset)).join("")}
          ${option("custom", "Other (enter servers)", preset)}
        </select>
        <label class="field-label" for="email">Email address</label>
        <input class="input" id="email" name="email" type="email" required maxlength="254" value="${escapeHtml(values.email ?? "")}" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false">
        <label class="field-label" for="password">App password</label>
        <input class="input" id="password" name="password" type="password" required maxlength="200" autocomplete="new-password">
        <span class="field-hint">Not your normal password. <a href="#about-app-passwords">What’s an app password?</a></span>
        <details class="advanced" id="advanced"${preset === "custom" ? " open" : ""}>
          <summary>Server settings</summary>
          <div class="advanced-body">
            <label class="field-label" for="username">User name (if not the email address)</label>
            <input class="input" id="username" name="username" maxlength="254" value="${escapeHtml(values.username ?? "")}">
            <div class="grid-2">
              <div><label class="field-label" for="imap_host">IMAP server</label><input class="input" id="imap_host" name="imap_host" maxlength="253" value="${escapeHtml(values.imapHost ?? "")}"></div>
              <div><label class="field-label" for="imap_port">IMAP port</label><select class="input" id="imap_port" name="imap_port">${option("993", "993 (SSL/TLS)", values.imapPort ?? "993")}${option("143", "143 (STARTTLS)", values.imapPort)}</select></div>
              <div><label class="field-label" for="smtp_host">SMTP server</label><input class="input" id="smtp_host" name="smtp_host" maxlength="253" value="${escapeHtml(values.smtpHost ?? "")}"></div>
              <div><label class="field-label" for="smtp_port">SMTP port</label><select class="input" id="smtp_port" name="smtp_port">${option("465", "465 (SSL/TLS)", values.smtpPort ?? "465")}${option("587", "587 (STARTTLS)", values.smtpPort)}</select></div>
            </div>
            <label class="check"><input type="checkbox" name="save_sent" value="1"${values.saveSent === false ? "" : " checked"}> Save a copy of sent mail in the Sent folder</label>
          </div>
        </details>
        <p class="error" role="alert">${escapeHtml(input.error ?? "")}</p>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Check and add</button>
          <a class="btn btn-quiet" href="${back}">${icons.back}Back</a>
        </div>
      </form>
      <aside class="panel panel-pad explain" id="about-app-passwords" aria-labelledby="explain-title">
        <div class="stack">
          <p class="hud">${icons.key}App passwords</p>
          <h2 id="explain-title">What’s an app password?</h2>
          <p>A separate password your email provider makes just for one app. Vox never sees your real password, and you can revoke this one any time from your provider’s security settings.</p>
          <h3>Why do I need one?</h3>
          <p>Providers with two-factor sign-in don’t let apps use your normal password. An app password is how they let one app in, safely.</p>
          <hr>
          <h3 id="steps-title">Create one for ${escapeHtml(current?.name ?? "your provider")}</h3>
          <ol class="steps" id="steps">${steps}</ol>
        </div>
      </aside>
    </div>
  </main>
</div>
<script type="application/json" id="presets">${data}</script>`,
    `(() => {
  const { presets, custom } = JSON.parse(document.getElementById("presets").textContent);
  const $ = (id) => document.getElementById(id);
  function show() {
    const preset = presets[$("preset").value];
    $("steps-title").textContent = "Create one for " + (preset ? preset.name : "your provider");
    $("steps").replaceChildren(...(preset ? preset.steps : custom).map((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    }));
    if (preset) {
      $("imap_host").value = preset.imapHost;
      $("imap_port").value = String(preset.imapPort);
      $("smtp_host").value = preset.smtpHost;
      $("smtp_port").value = String(preset.smtpPort);
    }
    // Server settings stay out of the way unless the user enters their own.
    $("advanced").open = !preset;
  }
  $("preset").addEventListener("change", show);
  show();
})();`,
  );
}

/** Approval screen shown to a signed-in user when an MCP client asks for access. */
export function consentPage(input: { clientName: string; userName: string; accounts: string[]; google?: boolean; returnHost: string; query: string }) {
  const name = escapeHtml(input.clientName);
  const data = JSON.stringify({ query: input.query }).replace(/</g, "\\u003c");
  return shell(
    `Allow ${input.clientName}?`,
    `<div class="wrap narrow">
  ${topbar()}
  <main class="panel panel-pad">
    <div class="consent-head">
      <span class="mono big" aria-hidden="true">${escapeHtml(input.clientName.trim().charAt(0).toUpperCase() || "A")}</span>
      <span class="link" aria-hidden="true"></span>
      <span class="brand" aria-hidden="true" style="min-height:0">${brandMark()}</span>
    </div>
    <div class="stack">
      <p class="hud amber">Permission request</p>
      <h1>${name} wants to use your email</h1>
      <p class="muted">Signed in as ${escapeHtml(input.userName)}. Next you’ll return to <b style="color:var(--text)">${escapeHtml(input.returnHost)}</b>.</p>
      <div class="stack" style="gap:8px">
        <h2 style="font-size:15px">It will reach</h2>
        <div class="chips">${input.accounts.map((email) => `<span class="account-chip"><span class="dot"></span><b>${escapeHtml(email)}</b></span>`).join("")}</div>
        <p class="muted" style="font-size:14px">And any email accounts you add later.</p>
      </div>
      <div class="stack" style="gap:10px">
        <h2 style="font-size:15px">It can</h2>
        <ul class="checks">
          <li>${icons.check}<span>Search and read your email</span></li>
          <li>${icons.check}<span>Write drafts, and archive, label, and mark email read</span></li>
          ${input.google ? `<li>${icons.check}<span>See and change your Google calendar, tasks, contacts, and Drive files, where you’ve allowed it</span></li>` : ""}
          <li class="amber">${icons.mic}<span>Send, reply, forward, or move to Trash, only after your spoken confirmation</span></li>
        </ul>
      </div>
      <p class="muted" style="font-size:14px">You can disconnect it any time on this site.</p>
      <div class="btn-row">
        <button class="btn btn-primary" id="allow" type="button">Allow</button>
        <button class="btn" id="deny" type="button">Deny</button>
      </div>
      <p class="error" id="error" role="alert"></p>
    </div>
  </main>
</div>
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
