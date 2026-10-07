import { escapeHtml } from "./util.ts";

// Vox's holographic look: a deep navy ground with a faint HUD grid, thin cyan
// panels with corner brackets, small monospace labels, cyan for actions and
// amber for anything that needs the user. Dark only; no web fonts or images
// (the CSP allows neither), just inline SVG.

const baseStyles = `
  :root {
    color-scheme: dark;
    --bg: #020a12;
    --bg-2: #06131e;
    --cyan: #78ebff;
    --cyan-text: #9bf2ff;
    --cyan-ink: #00151b;
    --cyan-soft: rgb(120 235 255 / 9%);
    --cyan-line: rgb(120 235 255 / 40%);
    --amber: #f0b95e;
    --amber-text: #f0c887;
    --amber-soft: rgb(240 185 94 / 7%);
    --amber-line: rgb(240 185 94 / 38%);
    --danger: #ff9d90;
    --text: #eafcff;
    --text-2: #b9dfe6;
    --muted: #83aab5;
    --line: rgb(120 235 255 / 18%);
    --line-soft: rgb(120 235 255 / 9%);
    --panel: linear-gradient(180deg, rgb(7 28 41 / 86%), rgb(3 13 22 / 95%));
    --field: rgb(2 14 22 / 82%);
    --hud: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --ui: "Avenir Next", Avenir, system-ui, -apple-system, "Segoe UI", "PingFang TC", "Noto Sans TC", sans-serif;
  }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body {
    margin: 0; min-height: 100vh; overflow-x: hidden;
    font: 16px/1.55 var(--ui); color: var(--text); -webkit-font-smoothing: antialiased;
    background:
      radial-gradient(circle at 50% -8%, rgb(76 213 255 / 12%), transparent 560px),
      radial-gradient(circle at 92% 96%, rgb(245 198 109 / 5%), transparent 420px),
      linear-gradient(150deg, var(--bg) 0%, var(--bg-2) 52%, #020911 100%);
    background-attachment: fixed;
  }
  /* The HUD grid. */
  body::before {
    content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background-image: linear-gradient(rgb(120 235 255 / 3.5%) 1px, transparent 1px), linear-gradient(90deg, rgb(120 235 255 / 3.5%) 1px, transparent 1px);
    background-size: 72px 72px;
  }
  a { color: var(--cyan); }
  a:hover { color: var(--text); }
  button, input, select { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; border-radius: 6px; }
  form { margin: 0; }
  [hidden] { display: none !important; }

  .wrap { width: min(100% - 32px, 1040px); margin: 0 auto; padding: 0 0 56px; }
  .narrow { width: min(100% - 32px, 640px); }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 22px 0 30px; }
  .brand { display: inline-flex; align-items: center; gap: 10px; min-height: 44px; color: var(--text); font-weight: 650; letter-spacing: 0.01em; text-decoration: none; }
  .brand svg { width: 34px; height: 34px; color: var(--cyan); filter: drop-shadow(0 0 6px rgb(120 235 255 / 40%)); }
  .brand span b { color: var(--cyan-text); font-weight: 650; }
  .who { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 14px; }
  .who-name { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .hud { margin: 0; font-family: var(--hud); font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: rgb(120 235 255 / 72%); }
  .hud.amber { color: var(--amber); }
  .page-head { display: grid; gap: 8px; max-width: 680px; margin-bottom: 26px; }
  h1 { margin: 0; font-size: clamp(28px, 4vw, 34px); font-weight: 600; line-height: 1.15; letter-spacing: -0.01em; }
  h2 { margin: 0; font-size: 19px; font-weight: 600; line-height: 1.3; }
  h3 { margin: 0; font-size: 15px; font-weight: 600; }
  .lede { margin: 0; color: #9fc3cc; font-size: 16px; line-height: 1.6; }
  p { margin: 0; }
  .muted { color: var(--muted); }

  /* Panels with corner brackets. */
  .panel { position: relative; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); box-shadow: 0 0 40px rgb(120 235 255 / 5%), inset 0 0 26px rgb(120 235 255 / 4%); }
  .panel::before, .panel::after { content: ""; position: absolute; width: 22px; height: 22px; pointer-events: none; }
  .panel::before { top: -1px; left: -1px; border-top: 2px solid var(--cyan); border-left: 2px solid var(--cyan); border-top-left-radius: 12px; }
  .panel::after { right: -1px; bottom: -1px; border-right: 2px solid var(--cyan); border-bottom: 2px solid var(--cyan); border-bottom-right-radius: 12px; }
  .panel-pad { padding: 22px 22px 24px; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px 8px; }
  .stack { display: grid; gap: 18px; }
  .note { display: flex; gap: 14px; padding: 16px 18px; border: 1px solid var(--amber-line); border-radius: 12px; background: var(--amber-soft); }
  .note svg { width: 22px; height: 22px; flex-shrink: 0; color: var(--amber); }
  .note p { color: #9fc3cc; font-size: 14px; line-height: 1.6; }
  .note h3 { margin-bottom: 3px; }

  /* Buttons: 44px targets. */
  .btn { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; padding: 0 18px; border: 1px solid var(--line); border-radius: 999px; background: rgb(4 24 37 / 60%); color: var(--text); font-size: 15px; font-weight: 600; line-height: 1.2; text-decoration: none; cursor: pointer; transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease; }
  .btn:hover { border-color: var(--cyan-line); background: var(--cyan-soft); color: var(--text); }
  .btn svg { width: 17px; height: 17px; flex-shrink: 0; }
  .btn-primary { border-color: transparent; background: var(--cyan); color: var(--cyan-ink); box-shadow: 0 0 18px rgb(120 235 255 / 28%); }
  .btn-primary:hover { border-color: transparent; background: #b0f4ff; color: var(--cyan-ink); }
  .btn-amber { border-color: transparent; background: var(--amber); color: #1c1303; box-shadow: 0 0 16px rgb(240 185 94 / 25%); }
  .btn-amber:hover { border-color: transparent; background: #f6cd85; color: #1c1303; }
  .btn-quiet { border-color: transparent; background: transparent; color: var(--muted); font-weight: 500; }
  .btn-quiet:hover { border-color: transparent; color: var(--text); }
  .btn-danger:hover { color: var(--danger); background: rgb(255 157 144 / 8%); }
  .btn-sm { min-height: 44px; padding: 0 14px; font-size: 14px; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-row { display: flex; flex-wrap: wrap; gap: 10px; }

  .dot { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 9px rgb(120 235 255 / 70%); }
  .dot.amber { background: var(--amber); box-shadow: 0 0 9px rgb(240 185 94 / 80%); }
  .chip { display: inline-flex; align-items: center; padding: 3px 10px; border: 1px solid var(--cyan-line); border-radius: 999px; color: var(--cyan-text); font-family: var(--hud); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }

  /* Provider monograms. */
  .mono { display: grid; width: 44px; height: 44px; flex-shrink: 0; place-items: center; border: 1px solid var(--line); border-radius: 11px; background: radial-gradient(circle at 30% 25%, rgb(120 235 255 / 16%), rgb(4 22 34 / 90%) 70%); color: var(--cyan-text); font-weight: 700; font-size: 18px; box-shadow: inset 0 0 12px rgb(120 235 255 / 8%); }
  .mono.small-text { font-size: 10.5px; letter-spacing: 0.02em; }
  .mono.big { width: 52px; height: 52px; border-radius: 13px; font-size: 21px; }
  .mono.big.small-text { font-size: 12px; }

  /* Account and app rows. */
  .rows { margin: 0; padding: 0 0 6px; list-style: none; }
  .row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px 16px; padding: 14px 20px; border-top: 1px solid var(--line-soft); }
  .row-main { display: grid; gap: 3px; min-width: 0; }
  .row-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; font-size: 16px; font-weight: 600; }
  .row-title .address { min-width: 0; overflow-wrap: anywhere; }
  .row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; color: var(--muted); font-size: 13.5px; }
  .row-meta .state { display: inline-flex; align-items: center; gap: 7px; }
  .row-meta .state.amber { color: var(--amber-text); }
  .row-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
  .row-allow { margin-top: 8px; }
  .empty { display: grid; gap: 14px; justify-items: start; padding: 8px 20px 22px; }
  .empty p { color: #9fc3cc; }
  .code { display: block; margin-top: 6px; padding: 10px 12px; overflow-wrap: anywhere; border: 1px solid var(--line-soft); border-radius: 9px; background: var(--field); color: var(--cyan-text); font-family: var(--hud); font-size: 13px; }
  .section-foot { padding: 4px 20px 20px; }

  /* Tiles (landing and add account). */
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 14px; }
  .tile { position: relative; display: grid; align-content: start; gap: 12px; min-height: 100%; padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: rgb(4 25 38 / 55%); color: var(--text); text-decoration: none; transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease; }
  a.tile:hover { border-color: rgb(120 235 255 / 55%); background: rgb(8 36 52 / 70%); box-shadow: 0 0 26px rgb(120 235 255 / 12%); color: var(--text); }
  .tile p { color: #9fc3cc; font-size: 14.5px; line-height: 1.55; }
  .tile .tile-foot { display: flex; align-items: center; gap: 8px; margin-top: 4px; color: var(--cyan-text); font-size: 14px; font-weight: 600; }
  .tile .tile-foot svg { width: 16px; height: 16px; }

  /* Forms. */
  label.field-label { display: block; margin: 16px 0 6px; color: var(--text-2); font-size: 14px; font-weight: 600; }
  .field-hint { display: block; margin-top: 6px; color: var(--muted); font-size: 13px; }
  .input, select.input { width: 100%; min-height: 46px; padding: 10px 14px; border: 1px solid rgb(120 235 255 / 24%); border-radius: 10px; background: var(--field); color: var(--text); }
  select.input { appearance: none; padding-right: 40px; background-image: linear-gradient(45deg, transparent 50%, var(--cyan) 50%), linear-gradient(135deg, var(--cyan) 50%, transparent 50%); background-position: calc(100% - 20px) 50%, calc(100% - 15px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
  select.input option { background: #06131e; color: var(--text); }
  .input:hover { border-color: rgb(120 235 255 / 38%); }
  .input:focus { border-color: var(--cyan); outline: none; box-shadow: 0 0 0 3px rgb(120 235 255 / 18%); }
  .input:focus-visible { outline: none; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
  details.advanced { margin-top: 18px; border: 1px solid var(--line-soft); border-radius: 10px; background: rgb(2 12 20 / 50%); }
  details.advanced summary { display: flex; min-height: 46px; align-items: center; gap: 10px; padding: 0 14px; cursor: pointer; color: var(--text-2); font-weight: 600; list-style: none; }
  details.advanced summary::-webkit-details-marker { display: none; }
  details.advanced summary::before { content: ""; width: 7px; height: 7px; border-right: 2px solid var(--cyan); border-bottom: 2px solid var(--cyan); transform: rotate(-45deg); transition: transform 160ms ease; }
  details.advanced[open] summary::before { transform: rotate(45deg); }
  details.advanced .advanced-body { padding: 0 14px 16px; }
  .check { display: flex; gap: 10px; align-items: center; min-height: 44px; margin-top: 10px; color: var(--text-2); font-size: 14px; }
  .check input { width: 18px; height: 18px; accent-color: var(--cyan); }
  .error { margin-top: 16px !important; padding: 12px 14px; border: 1px solid rgb(255 157 144 / 40%); border-radius: 10px; background: rgb(255 157 144 / 7%); color: #ffc4bb; font-size: 14.5px; }
  .error:empty { display: none; }
  .form-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }

  .steps { display: grid; gap: 10px; margin: 12px 0 0; padding: 0; list-style: none; counter-reset: step; }
  .steps li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; color: var(--text-2); font-size: 14.5px; line-height: 1.5; counter-increment: step; }
  .steps li::before { content: counter(step, decimal-leading-zero); padding-top: 2px; color: var(--cyan-text); font-family: var(--hud); font-size: 12px; }
  .explain p:not(.hud) { color: #9fc3cc; font-size: 14.5px; line-height: 1.6; }
  .hud svg { width: 13px; height: 13px; margin-right: 7px; vertical-align: -2px; }
  .explain .stack { gap: 16px; }
  .explain hr { width: 100%; height: 1px; margin: 2px 0; border: 0; background: var(--line-soft); }

  .checks { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .checks li { display: grid; grid-template-columns: 22px 1fr; gap: 10px; color: var(--text-2); font-size: 15px; line-height: 1.5; }
  .checks svg { width: 20px; height: 20px; margin-top: 1px; color: var(--cyan); }
  .checks li.amber svg { color: var(--amber); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .account-chip { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: rgb(4 25 38 / 60%); font-size: 14px; overflow-wrap: anywhere; }
  .account-chip b { font-weight: 600; }

  /* Signed-out landing. */
  .hero { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr); align-items: center; gap: 28px 40px; padding: 18px 0 34px; }
  .hero h1 { font-size: clamp(36px, 6vw, 58px); letter-spacing: -0.02em; }
  .hero .lede { max-width: 34em; font-size: 17px; }
  .hero-copy { display: grid; gap: 16px; }
  .reactor { justify-self: center; width: min(100%, 300px); color: var(--cyan); filter: drop-shadow(0 0 8px rgb(120 235 255 / 38%)); }
  .reactor svg { display: block; width: 100%; height: auto; }
  .cta { display: grid; gap: 10px; justify-items: start; margin-top: 8px; }
  .cta .muted { font-size: 14px; }

  .consent-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .consent-head .link { width: 38px; height: 1px; background: linear-gradient(90deg, var(--cyan-line), transparent); }

  .spin, .spin-rev { transform-origin: 50% 50%; transform-box: view-box; }
  @media (prefers-reduced-motion: no-preference) {
    .spin { animation: vx-spin 28s linear infinite; }
    .spin-rev { animation: vx-spin 46s linear infinite reverse; }
  }
  @keyframes vx-spin { to { transform: rotate(360deg); } }

  @media (max-width: 860px) {
    .hero { grid-template-columns: 1fr; }
    .reactor { order: -1; width: 180px; }
    .with-aside { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 560px) {
    .topbar { padding: 14px 0 18px; }
    .panel-pad { padding: 18px 16px 20px; }
    .panel-head, .row, .empty, .section-foot { padding-left: 16px; padding-right: 16px; }
    .row { grid-template-columns: auto minmax(0, 1fr); }
    .row-actions { grid-column: 1 / -1; justify-content: flex-start; margin-left: 56px; }
    /* Line a leading text-only button up with the address above it. */
    .row-actions > form:first-child > .btn-quiet { margin-left: -14px; }
    .grid-2 { grid-template-columns: 1fr; }
    .btn-row > .btn, .form-actions > .btn { flex: 1 1 auto; }
    .who-name { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`;

function shell(title: string, body: string, script = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#020a12">
<title>${escapeHtml(title)}</title>
<style>${baseStyles}</style>
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
  <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="1.4 3.1" opacity="0.55"/>
  <circle class="spin" cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="22 7 5 7 30 12" opacity="0.9"/>
  <circle cx="24" cy="24" r="13.5" fill="rgb(120 235 255 / 14%)" stroke="currentColor" stroke-width="1" opacity="0.95"/>
  <rect x="16.5" y="19" width="15" height="10.5" rx="1.8" fill="none" stroke="#eafcff" stroke-width="1.6"/>
  <path d="M17.2 20l6.8 5 6.8-5" fill="none" stroke="#eafcff" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;
}

/** The big reactor on the landing page. */
function reactor() {
  return `<div class="reactor" aria-hidden="true"><svg viewBox="0 0 400 400">
  <defs><radialGradient id="core"><stop offset="0" stop-color="#f4ffff"/><stop offset="0.22" stop-color="#b5f6ff"/><stop offset="0.55" stop-color="#35b7d8" stop-opacity="0.55"/><stop offset="1" stop-color="#0b3a4d" stop-opacity="0"/></radialGradient></defs>
  <circle cx="200" cy="200" r="189" fill="none" stroke="currentColor" stroke-width="10" stroke-dasharray="1.2 8.7" opacity="0.4"/>
  <circle cx="200" cy="200" r="177" fill="none" stroke="currentColor" stroke-width="0.75" opacity="0.3"/>
  <circle class="spin" cx="200" cy="200" r="163" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="28 4 6 4 52 10 3 3 3 22 40 6 18 4 60 12 22 63" opacity="0.55"/>
  <g class="spin-rev">
    <circle cx="200" cy="200" r="144" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="92 88 64 116" pathLength="360" opacity="0.85"/>
    <circle cx="200" cy="200" r="144" fill="none" stroke="#f0b95e" stroke-width="3" stroke-dasharray="0 100 22 238" pathLength="360" opacity="0.95"/>
  </g>
  <circle cx="200" cy="200" r="124" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 6" opacity="0.45"/>
  <circle cx="200" cy="200" r="106" fill="none" stroke="currentColor" stroke-width="14" stroke-dasharray="1.5 56" opacity="0.4"/>
  <circle cx="200" cy="200" r="84" fill="none" stroke="#d8fbff" stroke-width="2" opacity="0.4"/>
  <circle cx="200" cy="200" r="74" fill="url(#core)" opacity="0.8"/>
  <rect x="160" y="175" width="80" height="54" rx="8" fill="rgb(2 14 22 / 55%)" stroke="#eafcff" stroke-width="3.5"/>
  <path d="M163 180l37 27 37-27" fill="none" stroke="#eafcff" stroke-width="3.5" stroke-linejoin="round"/>
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
    <p class="hud">Vox Mail / Notice</p>
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
        <p class="hud">Vox Mail / Sign in</p>
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
  return `<div class="row-meta"><span>Vox can use ${wordList(allowed)}${allowed.length === 1 ? " only" : ""}</span></div>${button}`;
}

/** The signed-in home page: the connected email accounts and the apps that use them. */
export function homePage(state: HomeState) {
  const accounts = state.accounts.length
    ? `<ul class="rows">${state.accounts
        .map((account) => {
          const ok = account.status === "connected";
          return `<li class="row">
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
  return shell(
    "Vox Mail",
    `<div class="wrap narrow" style="width:min(100% - 32px, 860px)">
  ${topbar(`<form class="who" method="post" action="/auth/logout"><span class="who-name">${escapeHtml(state.userName)}</span><button class="btn btn-sm btn-quiet" type="submit">${icons.signout}Sign out</button></form>`)}
  <main class="stack" style="gap:22px">
    <div class="page-head">
      <p class="hud">Vox Mail / Accounts</p>
      <h1>Email accounts</h1>
      <p class="lede">Vox searches, reads, drafts, and tidies every account below. New email goes out from the primary account unless you say otherwise. A Google account can also share its calendar, tasks, contacts, and Drive files.</p>
    </div>
    <section class="panel" aria-labelledby="accounts-title">
      <div class="panel-head"><h2 id="accounts-title" class="hud" style="color:var(--muted)">Mailboxes</h2>${state.accounts.length ? add : ""}</div>
      ${accounts}
      ${state.accounts.length ? "" : `<div class="section-foot">${add}</div>`}
    </section>
    <section class="note" aria-label="Safety">
      ${icons.shield}
      <div><h3>Nothing leaves without your spoken yes</h3>
      <p>Before Vox sends, replies, forwards, or trashes email, it reads back who it’s going to and what it says, and waits for you. The same goes for inviting people to an event, deleting an event or a task, and moving a Drive file to the trash.</p></div>
    </section>
    <section class="panel" aria-labelledby="apps-title">
      <div class="panel-head"><h2 id="apps-title" class="hud" style="color:var(--muted)">Connected apps</h2></div>
      ${apps}
      <div class="section-foot"><span class="hud" style="color:var(--muted)">MCP server address</span><code class="code">${escapeHtml(state.mcpUrl)}</code></div>
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
      <p class="hud">Vox Mail / Add account</p>
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
      <p class="hud">Vox Mail / Add account / IMAP</p>
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
        <input class="input" id="email" name="email" type="email" required maxlength="254" value="${escapeHtml(values.email ?? "")}" autocomplete="username">
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
      <p class="hud amber">Vox Mail / Authorization request</p>
      <h1>${name} wants to use your email</h1>
      <p class="muted">Signed in as ${escapeHtml(input.userName)}. Next you’ll return to <b style="color:var(--text)">${escapeHtml(input.returnHost)}</b>.</p>
      <div class="stack" style="gap:8px">
        <h2 class="hud" style="color:var(--muted)">It will reach</h2>
        <div class="chips">${input.accounts.map((email) => `<span class="account-chip"><span class="dot"></span><b>${escapeHtml(email)}</b></span>`).join("")}</div>
        <p class="muted" style="font-size:14px">And any email accounts you add later.</p>
      </div>
      <div class="stack" style="gap:10px">
        <h2 class="hud" style="color:var(--muted)">It can</h2>
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
