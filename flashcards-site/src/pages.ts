import { escapeHtml } from "./util.ts";
import { appleSiteBase } from "../../lib/apple-site.ts";

// Flash Cards shares Vox's system typography and adaptive surfaces. The deck
// metaphor stays in the quiet card shapes, while study content remains plain.
const baseStyles = `${appleSiteBase}
  :root {
    --paper: var(--glass-strong);
    --again: var(--danger);
    --hard: #99651d;
    --good: var(--success);
    --easy: var(--accent);
    --new: var(--line);
  }
  body { font-optical-sizing: auto; }
  [hidden] { display: none !important; }
  .wrap { width: min(100% - 3rem, 1080px); margin: 0 auto; padding-bottom: env(safe-area-inset-bottom); }
  .topbar { display: flex; align-items: center; justify-content: space-between; min-height: 5rem; gap: 1rem; padding: 1rem 0; }
  .wordmark { display: inline-flex; align-items: center; gap: .65rem; color: var(--text); font-size: .9375rem; font-weight: 650; text-decoration: none; white-space: nowrap; }
  .wordmark-mark { position: relative; width: 1.9rem; height: 1.9rem; border-radius: .65rem; background: var(--accent-soft); }
  .wordmark-mark::before, .wordmark-mark::after { content: ""; position: absolute; width: 1rem; height: .7rem; border: 1.5px solid var(--accent); border-radius: 3px; }
  .wordmark-mark::before { top: .5rem; left: .4rem; opacity: .45; }
  .wordmark-mark::after { top: .7rem; left: .6rem; background: var(--accent-soft); }
  .card { position: relative; color: var(--text); background: var(--paper); border: 1px solid var(--line); border-radius: 1.25rem; box-shadow: 0 2px 8px rgb(var(--ink) / .025); }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.75rem; padding: .6rem 1.15rem; border: 1px solid transparent; border-radius: .75rem; font-size: .9375rem; line-height: 1.3; font-weight: 600; text-decoration: none; cursor: pointer; touch-action: manipulation; transition: background-color 120ms, transform 100ms; }
  .button-primary { color: white; background: var(--accent); }
  .button-quiet { color: var(--text); background: var(--glass); border-color: var(--line); }
  .button:disabled { opacity: .45; cursor: default; }
  .button:not(:disabled):active, .grade:not(:disabled):active, .chip:active, .pile:active { transform: scale(.98); }
  .link-button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: .45rem .65rem; border: 0; border-radius: .6rem; background: none; color: var(--text-2); cursor: pointer; font-size: .875rem; text-decoration: none; }
  .link-button:hover { background: var(--field); color: var(--text); }
  .link-button.danger { color: var(--danger); }
  .nav { display: flex; gap: .25rem; margin-right: .5rem; padding: .2rem; background: var(--field); border-radius: .8rem; }
  .nav a { display: inline-flex; align-items: center; min-height: 2.4rem; padding: .4rem .75rem; border-radius: .6rem; color: var(--text-2); font-size: .875rem; font-weight: 600; text-decoration: none; }
  .nav a[aria-current="page"] { background: var(--paper); color: var(--text); box-shadow: 0 1px 3px rgb(var(--ink) / .06); }
  .who-name { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8125rem; color: var(--muted); }
  .field { min-height: 2.75rem; width: 100%; padding: .65rem .85rem; border: 1px solid var(--line); border-radius: .7rem; background: var(--field); color: var(--text); }
  .error { color: var(--danger); min-height: 1.5em; font-size: .875rem; }
  .error:empty { min-height: 0; margin: 0; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  button, a, .flip { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  @media (prefers-color-scheme: dark) { :root { --hard: #d8ac6b; } .button-primary { color: #101018; } }
  @media (max-width: 600px) {
    .wrap { width: min(100% - 2rem, 1080px); }
    .topbar { flex-wrap: wrap; gap: .75rem; padding: 1rem 0; }
    #account { width: 100%; justify-content: space-between; }
    .nav { margin-right: auto; }
    .nav a { min-height: 2.75rem; }
    .who-name { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } .button:active, .grade:active, .chip:active, .pile:active { transform: none !important; } }
  @media (prefers-contrast: more) { .card, .button-quiet, .field, .grade { border-color: var(--text-2); } }
`;

function shell(title: string, body: string, script = "", extraStyles = "") {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16161b" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(title)}</title>
<style>${baseStyles}${extraStyles}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

const smallPageStyles = `
  .solo { width: min(100% - 2rem, 480px); margin: clamp(2rem, 10vh, 6rem) auto; padding-bottom: env(safe-area-inset-bottom); }
  .solo .card { padding: 1.75rem; }
  .solo h1 { margin: 0 0 .85rem; font: 650 1.5rem/1.25 var(--ui); letter-spacing: -.025em; color: var(--text); }
  .solo p, .solo li { color: var(--text-2); line-height: 1.65; margin: 0; }
  .solo ul { margin: 1rem 0; padding-left: 1.25rem; }
  .solo li + li { margin-top: .4rem; }
  .solo .actions { display: grid; gap: .65rem; margin-top: 1.5rem; }
  .solo .error:not(:empty) { margin-top: 1rem; color: var(--danger); }
`;

export function messagePage(title: string, message: string, link?: { href: string; label: string }) {
  return shell(
    title,
    `<main class="solo">
  <a class="wordmark" href="/" style="margin-bottom:18px"><span class="wordmark-mark" aria-hidden="true"></span>Vox Flash Cards</a>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${link ? `<div class="actions"><a class="button button-primary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></div>` : ""}
  </div>
</main>`,
    "",
    smallPageStyles,
  );
}

/** Approval screen shown to a signed-in user when an MCP client asks for access. */
export function consentPage(input: { clientName: string; userName: string; returnHost: string; query: string }) {
  const name = escapeHtml(input.clientName);
  const data = JSON.stringify({ query: input.query }).replace(/</g, "\\u003c");
  return shell(
    `Allow ${input.clientName}?`,
    `<main class="solo">
  <a class="wordmark" href="/" style="margin-bottom:18px"><span class="wordmark-mark" aria-hidden="true"></span>Vox Flash Cards</a>
  <div class="card">
    <h1>Allow ${name} to use your cards?</h1>
    <p>You’re signed in as ${escapeHtml(input.userName)}. ${name} will be able to:</p>
    <ul>
      <li>see your decks and cards</li>
      <li>add, edit, and delete cards and decks</li>
      <li>quiz you and record how each review went</li>
    </ul>
    <p style="margin-top:8px">You can disconnect it anytime on this site. Next you’ll return to ${escapeHtml(input.returnHost)}.</p>
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
    smallPageStyles,
  );
}

const appStyles = `
  .landing { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); gap: clamp(2rem, 6vw, 5rem); align-items: center; min-height: min(44rem, calc(100dvh - 5rem)); padding: 2rem 0 4rem; }
  .landing h1 { margin: 0 0 1rem; max-width: 13ch; font: 650 clamp(2rem, 4vw, 2.8rem)/1.12 var(--ui); color: var(--text); letter-spacing: -.04em; }
  .landing p { max-width: 34em; margin: 0 0 1.5rem; font-size: 1rem; line-height: 1.7; }
  .demo-hint { margin: .9rem 0 0; font-size: .8125rem; color: var(--muted); text-align: center; }
  .flip { position: relative; display: block; width: 100%; height: clamp(18rem, 32vw, 23rem); padding: 0; border: 0; border-radius: 1.25rem; background: none; cursor: pointer; text-align: left; }
  .face { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 3.5rem 2rem 1.5rem; overflow-y: auto; overscroll-behavior: contain; transition: opacity 140ms ease; }
  .face-front { opacity: 1; }
  .face-back { opacity: 0; pointer-events: none; }
  .flip.is-flipped .face-front { opacity: 0; pointer-events: none; }
  .flip.is-flipped .face-back { opacity: 1; pointer-events: auto; }
  .face-text { margin: auto 0; font: 500 clamp(1.15rem, 2.2vw, 1.45rem)/1.65 var(--ui); color: var(--text); overflow-wrap: anywhere; white-space: pre-wrap; }
  .study-stage .face-text.is-long { font-size: 1.0625rem; }
  .face-note { margin-top: 1rem; padding-top: .8rem; border-top: 1px solid var(--line-soft); font-size: .9375rem; line-height: 1.65; color: var(--text-2); white-space: pre-wrap; }
  .face-note:empty { display: none; }
  .face-corner { position: absolute; top: 1.2rem; left: 2rem; right: 2rem; display: flex; justify-content: space-between; gap: 1rem; font-size: .8125rem; line-height: 1.5; color: var(--muted); }
  .face-corner > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .face-corner > :last-child { flex-shrink: 0; }
  .today { display: flex; flex-direction: column; align-items: center; width: min(100%, 680px); margin: 0 auto; padding: 1rem 0 3rem; }
  .today-head { display: grid; justify-items: center; gap: 1rem; margin-bottom: 1.25rem; text-align: center; max-width: 100%; }
  .today h1 { display: flex; align-items: baseline; gap: .6rem; margin: 0; font-size: .9375rem; font-weight: 500; color: var(--text-2); }
  .due-number { font-size: 1.9rem; font-weight: 650; line-height: 1.15; letter-spacing: -.035em; color: var(--text); font-variant-numeric: tabular-nums; }
  .study-stage { position: relative; width: 100%; }
  .study-stage::before { content: ""; position: absolute; inset: .3rem .6rem -.3rem; border: 1px solid var(--line); border-radius: 1.25rem; background: var(--paper); opacity: 0; }
  .study-stage.has-more::before { opacity: 1; }
  .study-stage .flip { z-index: 1; }
  .grades { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem; width: 100%; margin-top: 1.25rem; }
  .grade { display: grid; gap: .2rem; align-content: center; min-height: 3.5rem; padding: .6rem .4rem; border: 1px solid var(--line); border-radius: .85rem; background: var(--paper); color: var(--text); cursor: pointer; font-size: .9375rem; font-weight: 600; transition: transform 100ms, background-color 120ms; }
  .grade small { font-size: .75rem; font-weight: 400; color: var(--text-2); }
  .grade[data-rating="again"] { border-top: 3px solid var(--again); }
  .grade[data-rating="hard"] { border-top: 3px solid var(--hard); }
  .grade[data-rating="good"] { border-top: 3px solid var(--good); }
  .grade[data-rating="easy"] { border-top: 3px solid var(--easy); }
  .reveal-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; width: 100%; margin-top: 1.25rem; }
  .reveal-actions { display: flex; align-items: center; gap: .5rem; }
  .keys { font-size: .75rem; color: var(--muted); }
  @media (hover: none) { .keys { display: none; } }
  .scope { display: flex; flex-wrap: wrap; justify-content: center; gap: .35rem; }
  .chip { min-height: 2.75rem; padding: .55rem .9rem; border: 1px solid transparent; border-radius: .75rem; background: transparent; color: var(--text-2); cursor: pointer; font-size: .875rem; line-height: 1.3; transition: transform 100ms, background-color 120ms; }
  .chip[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .vox-note { max-width: 34rem; margin: 1.25rem 0 0; font-size: .8125rem; line-height: 1.65; color: var(--muted); text-align: center; }
  .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin: 0 0 1rem; }
  .section-head h2 { margin: 0; font-size: 1.25rem; font-weight: 650; letter-spacing: -.02em; color: var(--text); }
  .shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 1rem; padding-bottom: .5rem; }
  .pile { position: relative; display: block; width: 100%; padding: 0; border: 0; border-radius: 1rem; background: none; cursor: pointer; text-align: left; transition: transform 100ms; }
  .pile .card { display: flex; flex-direction: column; justify-content: flex-end; min-height: 8rem; padding: 2.8rem 1rem 1rem; border-radius: 1rem; }
  .pile-name { font-size: 1rem; font-weight: 600; line-height: 1.4; color: var(--text); overflow-wrap: anywhere; }
  .pile-meta { margin-top: .4rem; font-size: .8125rem; color: var(--text-2); }
  .pile-series { position: absolute; top: 1rem; left: 1rem; right: 1rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .75rem; color: var(--muted); }
  .pile-meta b { color: var(--again); font-weight: 600; }
  .pile-under { display: none; }
  .pile[aria-pressed="true"] .card { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .new-deck .card { border-style: dashed; background: transparent; box-shadow: none; justify-content: center; }
  .new-deck input { width: 100%; min-height: 2.75rem; padding: .4rem 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; color: var(--text); font-size: 1rem; }
  .deck-view { padding: 2rem 0 1.5rem; }
  .deck-view h2 { margin: 0; font-size: 1.5rem; color: var(--text); }
  .deck-view .section-head { flex-wrap: wrap; align-items: center; }
  .deck-tools { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .deck-tools .field { width: 220px; max-width: 100%; }
  .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); align-items: start; gap: 1rem; margin-top: 1.25rem; }
  .mini { display: flex; flex-direction: column; min-height: 12rem; padding: 2.75rem 1.15rem 1rem; }
  .mini.composer { padding-top: 1.15rem; }
  .mini-front { font-size: 1rem; font-weight: 500; line-height: 1.65; color: var(--text); overflow-wrap: anywhere; white-space: pre-wrap; }
  .mini-back { margin-top: .65rem; font-size: .9375rem; line-height: 1.65; color: var(--text-2); overflow-wrap: anywhere; white-space: pre-wrap; }
  .mini-tools { display: flex; justify-content: flex-end; gap: .25rem; margin-top: auto; padding-top: .5rem; }
  .mini-due { position: absolute; top: 1rem; left: 1.15rem; font-size: .75rem; color: var(--muted); }
  .composer textarea, .mini textarea { width: 100%; resize: vertical; min-height: 4rem; padding: .5rem 0; border: 0; background: transparent; color: var(--text); font-size: 1rem; line-height: 1.65; }
  .composer textarea::placeholder, .mini textarea::placeholder { color: var(--muted); }
  .composer .divider { height: 1px; margin: .4rem 0; background: var(--line); }
  .composer-actions { display: flex; justify-content: space-between; align-items: center; gap: .5rem; margin-top: auto; padding-top: .65rem; }
  .muted-line { color: var(--muted); font-size: .8125rem; }
  .apps { margin: 2rem 0 3rem; padding: 1rem 0; border-top: 1px solid var(--line); }
  .apps summary { display: flex; align-items: center; min-height: 2.75rem; cursor: pointer; font-size: .9375rem; font-weight: 600; color: var(--text-2); list-style: none; }
  .apps summary::-webkit-details-marker { display: none; }
  .apps summary::before { content: "+"; display: inline-block; width: 1.5em; color: var(--muted); }
  .apps[open] summary::before { content: "−"; }
  .apps-body { max-width: 640px; margin-top: .75rem; font-size: .9375rem; }
  .url-row { display: flex; gap: .5rem; margin: .75rem 0 1rem; }
  .url-row code { flex: 1; min-width: 0; padding: .75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: .7rem; background: var(--field); color: var(--text-2); font-size: .8125rem; }
  .app-list { margin: 0; padding: 0; list-style: none; }
  .app-list li { display: flex; justify-content: space-between; align-items: center; gap: .75rem; padding: .5rem 0; border-bottom: 1px solid var(--line-soft); }
  .toast { position: fixed; z-index: 5; left: 50%; bottom: max(1.5rem, env(safe-area-inset-bottom)); transform: translateX(-50%); width: max-content; max-width: calc(100% - 2rem); padding: .8rem 1.1rem; border: 1px solid var(--line); border-radius: .85rem; background: var(--glass-strong); color: var(--text); font-size: .875rem; box-shadow: var(--shadow); }
  @media (max-width: 820px) {
    .landing { grid-template-columns: 1fr; min-height: 0; gap: 2rem; }
    .landing h1 { max-width: 20ch; }
    .demo { width: min(100%, 580px); }
    .scope { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; max-width: 100%; padding: 0 .15rem .25rem; scrollbar-width: none; }
    .scope::-webkit-scrollbar { display: none; }
    .chip { flex: none; }
  }
  @media (max-width: 600px) {
    .today { padding-top: .5rem; padding-bottom: 2rem; }
    .flip { height: clamp(17rem, 40dvh, 23rem); }
    .face { padding: 3rem 1.25rem 1.25rem; }
    .face-corner { top: 1rem; left: 1.25rem; right: 1.25rem; font-size: .75rem; }
    .face-text { font-size: 1.125rem; }
    .study-stage .face-text.is-long { font-size: 1rem; }
    .grades { gap: .4rem; }
    .reveal-row .keys { display: none; }
    .reveal-actions { width: 100%; }
    .reveal-actions .button { flex: 1; }
    .shelf { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
    .pile .card { min-height: 8.5rem; padding: 2.5rem .85rem .85rem; }
    .pile-series { left: .85rem; right: .85rem; }
    .deck-tools { width: 100%; }
    .deck-tools .field { width: 100%; }
    .cards-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 360px) { .shelf { grid-template-columns: 1fr; } }
`;

/** The study desk. Signed-out visitors see what it is and "Sign in with Vox". */
export function appPage(mcpUrl: string) {
  const data = JSON.stringify({ mcpUrl }).replace(/</g, "\\u003c");
  return shell(
    "Vox Flash Cards",
    `<div class="wrap">
  <header class="topbar">
    <a class="wordmark" href="/"><span class="wordmark-mark" aria-hidden="true"></span>Vox Flash Cards</a>
    <div id="account" hidden style="display:flex;align-items:center;gap:6px">
      <nav class="nav" aria-label="Pages"><a href="/" aria-current="page">Study</a><a href="/stats">Statistics</a></nav>
      <span id="who" class="who-name"></span>
      <button class="link-button" id="signout" type="button">Sign out</button>
    </div>
  </header>

  <main id="signed-out" hidden class="landing">
    <div>
      <h1>Flash cards you can study out loud.</h1>
      <p>Keep your decks here. Then tell Vox “考我單字卡” and it quizzes you like a friend: one card at a time, a hint when you’re stuck, and nothing marked right unless it was.</p>
      <a class="button button-primary" href="/auth/login">Sign in with Vox</a>
    </div>
    <div class="demo">
      <button class="flip" id="demo-card" type="button" aria-label="Sample card. Tap to flip.">
        <div class="face face-front card"><span class="face-corner"><span>生物化學</span><span>Front</span></span><div class="face-text">糖解作用在細胞的哪裡進行？</div></div>
        <div class="face face-back card" aria-hidden="true"><span class="face-corner"><span>生物化學</span><span>Back</span></span><div class="face-text">細胞質（cytosol）</div><div class="face-note">不需要氧氣；1 葡萄糖 → 2 丙酮酸，淨得 2 ATP 與 2 NADH</div></div>
      </button>
      <p class="demo-hint">Tap the card to flip it</p>
    </div>
  </main>

  <div id="app" hidden>
    <section class="today" aria-labelledby="today-title">
      <header class="today-head">
        <h1 id="today-title"><span class="due-number" id="due-number">0</span> <span id="due-text">cards to review</span></h1>
        <div class="scope" id="scope" role="group" aria-label="Which deck to study"></div>
      </header>
      <div class="study-stage">
        <button class="flip" id="study-card" type="button" aria-live="polite">
          <div class="face face-front card"><span class="face-corner"><span id="card-deck"></span><span id="card-side-front">Question</span></span><div class="face-text" id="card-front"></div></div>
          <div class="face face-back card" aria-hidden="true"><span class="face-corner"><span id="card-deck-back"></span><span>Answer</span></span><div class="face-text" id="card-back"></div><div class="face-note" id="card-note"></div></div>
        </button>
      </div>
      <div class="reveal-row" id="reveal-row">
        <span class="keys">Space to flip, S to skip, 1–4 to grade</span>
        <div class="reveal-actions">
          <button class="button button-quiet" id="skip" type="button">Skip</button>
          <button class="button button-primary" id="reveal" type="button">Show answer</button>
        </div>
      </div>
      <div class="grades" id="grades" hidden role="group" aria-label="How well did you know it?">
        <button class="grade" data-rating="again" type="button">Again<small>forgot</small></button>
        <button class="grade" data-rating="hard" type="button">Hard<small>struggled</small></button>
        <button class="grade" data-rating="good" type="button">Good<small>knew it</small></button>
        <button class="grade" data-rating="easy" type="button">Easy<small>instantly</small></button>
      </div>
      <p class="vox-note">Or study by voice: connect this site in Vox, then say “let’s review my flash cards.”</p>
    </section>

    <section aria-labelledby="decks-title">
      <div class="section-head"><h2 id="decks-title">Decks</h2><span class="muted-line" id="deck-count"></span></div>
      <div class="shelf" id="shelf"></div>
    </section>

    <section class="deck-view" id="deck-view" hidden aria-labelledby="deck-title">
      <div class="section-head">
        <h2 id="deck-title"></h2>
        <div class="deck-tools">
          <input class="field" id="search" type="search" placeholder="Search this deck" aria-label="Search this deck">
          <button class="link-button" id="rename-deck" type="button">Rename</button>
          <button class="link-button danger" id="delete-deck" type="button">Delete deck</button>
        </div>
      </div>
      <div class="cards-grid" id="cards"></div>
    </section>

    <details class="apps">
      <summary>Use your cards in Claude, ChatGPT, or other MCP apps</summary>
      <div class="apps-body">
        <p>Add this address as a custom connector. The app will ask you to sign in with your Vox account and approve access.</p>
        <div class="url-row"><code id="mcp-url"></code><button class="button button-quiet" id="copy" type="button">Copy</button></div>
        <p style="margin:0 0 6px;font-weight:600">Connected apps</p>
        <ul class="app-list" id="apps"></ul>
      </div>
    </details>
    <p class="error" id="error" role="alert"></p>
  </div>
</div>
<div class="toast" id="toast" role="status" hidden></div>
<script type="application/json" id="config">${data}</script>`,
    `(() => {
  const { mcpUrl } = JSON.parse(document.getElementById("config").textContent);
  const $ = (id) => document.getElementById(id);
  let decks = [];
  let openDeckId = null;
  let studyDeckId = null;
  let current = null;
  let cards = [];
  let confirmId = null;

  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
  };

  let toastTimer = 0;
  function toast(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2600);
  }

  async function tool(name, args = {}) {
    const response = await fetch("/api/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: name, arguments: args }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) { location.reload(); throw new Error("You were signed out."); }
    if (!response.ok) throw new Error(payload.error || "That didn’t save. Try again.");
    return payload.result;
  }
  function fail(error) { $("error").textContent = error.message || String(error); }
  function clearError() { $("error").textContent = ""; }

  function relativeDue(iso) {
    if (!iso) return "";
    const minutes = Math.round((Date.parse(iso) - Date.now()) / 60000);
    if (minutes < 1) return "now";
    if (minutes < 60) return "in " + minutes + " min";
    const hours = Math.round(minutes / 60);
    if (hours < 24) return "in " + hours + " h";
    const days = Math.round(hours / 24);
    return days === 1 ? "tomorrow" : "in " + days + " days";
  }
  const deckName = (id) => decks.find((deck) => deck.id === id)?.name || "";
  // "KMU Post-Bac: Genetics" shows as "Genetics" with its series as a label.
  const splitName = (name) => {
    const at = name.indexOf(": ");
    return at > 0 && at < 30 ? { series: name.slice(0, at), title: name.slice(at + 2) } : { series: "", title: name };
  };

  // ---- Studying ----
  function setFlipped(flipped) {
    $("study-card").classList.toggle("is-flipped", flipped);
    $("study-card").querySelector(".face-front").setAttribute("aria-hidden", String(flipped));
    $("study-card").querySelector(".face-back").setAttribute("aria-hidden", String(!flipped));
    if (current) $("study-card").setAttribute("aria-label", flipped
      ? "Answer: " + current.back + (current.notes ? ". " + current.notes : "") + ". Choose a grade below, or tap to see the question."
      : "Question: " + current.front + ". Tap to see the answer.");
    $("grades").hidden = !flipped || !current;
    $("reveal-row").hidden = flipped || !current;
  }

  async function loadNext() {
    const result = await tool("next_card", studyDeckId ? { deck: studyDeckId } : {});
    current = result.card || null;
    setFlipped(false);
    const due = current ? result.due_remaining : 0;
    document.querySelector(".study-stage").classList.toggle("has-more", due > 1);
    $("due-number").textContent = String(due);
    $("due-text").textContent = due === 1 ? "card to review" : "cards to review";
    const deckLabel = current ? splitName(deckName(current.deck_id)).title : studyDeckId ? splitName(deckName(studyDeckId)).title : "All decks";
    $("card-deck").textContent = deckLabel;
    $("card-deck-back").textContent = deckLabel;
    $("card-side-front").textContent = result.repeat ? "Missed earlier, try again" : "Question";
    if (current) {
      $("card-front").textContent = current.front;
      $("card-back").textContent = current.back;
      $("card-front").classList.toggle("is-long", current.front.length > 70);
      $("card-back").classList.toggle("is-long", current.back.length > 70);
      $("card-note").textContent = current.notes || "";
      $("study-card").setAttribute("aria-label", "Question: " + current.front + ". Tap to see the answer.");
    } else {
      $("card-front").textContent = decks.length
        ? (result.next_due_at ? "You’re all caught up. Next review " + relativeDue(result.next_due_at) + "." : "This deck has no cards yet.")
        : "Make your first deck below, then add a few cards.";
      $("card-back").textContent = "";
      $("card-note").textContent = "";
      $("study-card").setAttribute("aria-label", $("card-front").textContent);
      $("reveal-row").hidden = true;
    }
  }

  async function grade(rating) {
    if (!current) return;
    const card = current;
    current = null;
    $("grades").hidden = true;
    try { clearError(); await tool("grade_card", { card_id: card.card_id, review_id: card.review_id, rating, deck: studyDeckId || "" }); await Promise.all([loadNext(), loadDecks()]); }
    catch (error) { current = card; setFlipped(true); fail(error); }
  }

  async function skip() {
    if (!current) return;
    const card = current;
    current = null;
    try {
      clearError();
      await tool("skip_card", { card_id: card.card_id, review_id: card.review_id, deck: studyDeckId || "" });
      await loadNext();
      if (current && current.card_id === card.card_id) toast("That’s the last card due right now.");
    } catch (error) { current = card; fail(error); }
  }

  $("study-card").addEventListener("click", () => { if (current) setFlipped(!$("study-card").classList.contains("is-flipped")); });
  $("skip").addEventListener("click", skip);
  $("reveal").addEventListener("click", () => setFlipped(true));
  for (const button of document.querySelectorAll(".grade")) button.addEventListener("click", () => grade(button.dataset.rating));
  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea") || event.metaKey || event.ctrlKey || event.altKey || !current || $("app").hidden) return;
    const flipped = $("study-card").classList.contains("is-flipped");
    if (event.key === " " && !event.target.closest("button")) { event.preventDefault(); setFlipped(!flipped); }
    if (event.key === "s" || event.key === "S") skip();
    if (flipped && ["1", "2", "3", "4"].includes(event.key)) grade(["again", "hard", "good", "easy"][Number(event.key) - 1]);
  });

  function renderScope() {
    const options = [{ id: null, name: "All decks" }, ...decks.filter((deck) => deck.cardCount)];
    $("scope").replaceChildren(...options.map((option) => el("button", {
      className: "chip", type: "button", "aria-pressed": String(option.id === studyDeckId), text: splitName(option.name).title, title: option.name,
      onclick: () => { studyDeckId = option.id; renderScope(); loadNext().catch(fail); },
    })));
  }

  // ---- Decks ----
  async function loadDecks() {
    decks = (await tool("list_decks")).decks;
    if (studyDeckId && !decks.some((deck) => deck.id === studyDeckId)) studyDeckId = null;
    if (openDeckId && !decks.some((deck) => deck.id === openDeckId)) openDeckId = null;
    renderShelf();
    renderScope();
  }

  function renderShelf() {
    const piles = decks.map((deck) => {
      const depth = Math.min(3, Math.ceil(deck.cardCount / 15));
      const under = Array.from({ length: depth }, (_, index) => el("span", {
        className: "pile-under", "aria-hidden": "true",
        style: "top:" + (index + 1) * 4 + "px;transform:rotate(" + [-1.2, 1, -0.6][index] + "deg);z-index:" + -index,
      }));
      return el("button", {
        className: "pile", type: "button", "aria-pressed": String(deck.id === openDeckId),
        onclick: () => { openDeckId = deck.id === openDeckId ? null : deck.id; confirmId = null; renderShelf(); loadCards().catch(fail); },
      }, [
        ...under,
        el("div", { className: "card" }, [
          ...(splitName(deck.name).series ? [el("div", { className: "pile-series", text: splitName(deck.name).series })] : []),
          el("div", { className: "pile-name", text: splitName(deck.name).title }),
          el("div", { className: "pile-meta" }, [
            document.createTextNode(deck.cardCount + (deck.cardCount === 1 ? " card" : " cards")),
            ...(deck.dueCount ? [document.createTextNode(", "), el("b", { text: deck.dueCount + " due" })] : []),
          ]),
        ]),
      ]);
    });
    const input = el("input", { placeholder: "New deck name", "aria-label": "New deck name", maxlength: "80" });
    const create = el("form", {
      className: "pile new-deck",
      onsubmit: async (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        try { clearError(); const { deck } = await tool("create_deck", { name }); openDeckId = deck.id; await loadDecks(); await loadCards(); toast("Created " + deck.name); }
        catch (error) { fail(error); }
      },
    }, [el("div", { className: "card" }, [input, el("div", { className: "pile-meta", text: "Press Enter to create" })])]);
    $("shelf").replaceChildren(...piles, create);
    $("deck-count").textContent = decks.length ? decks.length + (decks.length === 1 ? " deck" : " decks") : "";
  }

  // ---- Deck view ----
  async function loadCards() {
    const deck = decks.find((candidate) => candidate.id === openDeckId);
    $("deck-view").hidden = !deck;
    if (!deck) return;
    $("deck-title").textContent = deck.name;
    $("delete-deck").textContent = confirmId === deck.id ? "Delete " + deck.cardCount + " cards for good?" : "Delete deck";
    const query = $("search").value.trim();
    cards = (await tool("list_cards", { deck: deck.id, limit: 200, ...(query ? { query } : {}) })).cards;
    renderCards();
  }

  function composer() {
    const front = el("textarea", { placeholder: "Front: a question, a term, or a sentence with ____", "aria-label": "Front", maxlength: "500", rows: "2" });
    const back = el("textarea", { placeholder: "Back: the answer", "aria-label": "Back", maxlength: "1000", rows: "2" });
    const notes = el("textarea", { placeholder: "Memory hook (optional)", "aria-label": "Memory hook", maxlength: "1000", rows: "1" });
    const form = el("form", {
      className: "card mini composer",
      onsubmit: async (event) => {
        event.preventDefault();
        if (!front.value.trim() || !back.value.trim()) return;
        try {
          clearError();
          await tool("add_cards", { deck: openDeckId, cards: [{ front: front.value, back: back.value, ...(notes.value.trim() ? { notes: notes.value } : {}) }] });
          await loadDecks(); await loadCards(); if (!current) await loadNext();
          $("cards").querySelector(".composer textarea")?.focus();
          toast("Card added");
        } catch (error) { fail(error); }
      },
    }, [front, el("div", { className: "divider", "aria-hidden": "true" }), back, notes,
      el("div", { className: "composer-actions" }, [el("span", { className: "muted-line", text: "New card" }), el("button", { className: "button button-primary", type: "submit", text: "Add card" })])]);
    return form;
  }

  function renderCards() {
    const items = cards.map((card) => {
      const item = el("article", { className: "card mini" });
      const view = () => {
        item.replaceChildren(
          el("span", { className: "mini-due", text: card.reps ? "Next review " + relativeDue(card.dueAt) : "New" }),
          el("div", { className: "mini-front", text: card.front }),
          el("div", { className: "mini-back", text: card.back }),
          ...(card.notes ? [el("div", { className: "mini-back", style: "font-size:.875rem;color:var(--muted)", text: card.notes })] : []),
          el("div", { className: "mini-tools" }, [
            el("button", { className: "link-button", type: "button", text: "Edit", onclick: edit }),
            el("button", {
              className: "link-button danger", type: "button", text: confirmId === card.id ? "Delete this card?" : "Delete",
              onclick: async () => {
                if (confirmId !== card.id) { confirmId = card.id; renderCards(); return; }
                try { clearError(); await tool("delete_card", { card_id: card.id }); confirmId = null; await loadDecks(); await loadCards(); await loadNext(); toast("Card deleted"); }
                catch (error) { fail(error); }
              },
            }),
          ]),
        );
      };
      const edit = () => {
        const front = el("textarea", { "aria-label": "Front", maxlength: "500", rows: "2" }); front.value = card.front;
        const back = el("textarea", { "aria-label": "Back", maxlength: "1000", rows: "2" }); back.value = card.back;
        const notes = el("textarea", { "aria-label": "Memory hook", maxlength: "1000", rows: "1", placeholder: "Memory hook (optional)" }); notes.value = card.notes || "";
        const form = el("form", {
          style: "display:contents",
          onsubmit: async (event) => {
            event.preventDefault();
            try { clearError(); await tool("edit_card", { card_id: card.id, front: front.value, back: back.value, notes: notes.value }); await loadCards(); await loadNext(); toast("Card saved"); }
            catch (error) { fail(error); }
          },
        }, [front, el("div", { className: "divider", "aria-hidden": "true", style: "height:1px;margin:4px 0 6px;background:var(--line)" }), back, notes,
          el("div", { className: "composer-actions" }, [
            el("button", { className: "link-button", type: "button", text: "Cancel", onclick: view }),
            el("button", { className: "button button-primary", type: "submit", text: "Save card" }),
          ])]);
        item.classList.add("composer");
        item.replaceChildren(form);
        front.focus();
      };
      view();
      return item;
    });
    $("cards").replaceChildren(composer(), ...items);
  }

  $("rename-deck").addEventListener("click", () => {
    const deck = decks.find((candidate) => candidate.id === openDeckId);
    if (!deck) return;
    const input = el("input", { className: "field", value: deck.name, maxlength: "80", "aria-label": "Deck name", style: "font-size:1rem;width:min(420px,100%)" });
    const form = el("form", {
      style: "display:flex;gap:8px;flex-wrap:wrap",
      onsubmit: async (event) => {
        event.preventDefault();
        try { clearError(); await tool("update_deck", { deck: deck.id, name: input.value }); await loadDecks(); await loadCards(); toast("Deck renamed"); }
        catch (error) { fail(error); }
      },
    }, [input, el("button", { className: "button button-primary", type: "submit", text: "Save name" })]);
    $("deck-title").replaceChildren(form);
    input.focus();
  });
  $("delete-deck").addEventListener("click", async () => {
    if (confirmId !== openDeckId) { confirmId = openDeckId; loadCards().catch(fail); return; }
    try { clearError(); const name = deckName(openDeckId); await tool("delete_deck", { deck: openDeckId }); confirmId = null; openDeckId = null; await loadDecks(); await loadCards(); await loadNext(); toast("Deleted " + name); }
    catch (error) { fail(error); }
  });
  let searchTimer = 0;
  $("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadCards().catch(fail), 250); });

  // ---- Apps ----
  async function loadApps() {
    const response = await fetch("/api/connections", { cache: "no-store" });
    const payload = await response.json().catch(() => ({ apps: [] }));
    const apps = payload.apps || [];
    $("apps").replaceChildren(...(apps.length ? apps.map((app) => el("li", {}, [
      el("span", { text: app.name + (app.lastUsedAt ? ", last used " + new Date(app.lastUsedAt).toLocaleDateString() : "") }),
      el("button", {
        className: "link-button danger", type: "button", text: "Disconnect",
        onclick: async () => {
          await fetch("/api/connections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grantId: app.grantId }) });
          toast("Disconnected " + app.name);
          loadApps();
        },
      }),
    ])) : [el("li", { className: "muted-line", text: "No apps connected yet." })]));
  }
  $("mcp-url").textContent = mcpUrl;
  $("copy").addEventListener("click", () => navigator.clipboard?.writeText(mcpUrl).then(() => toast("Address copied")));
  $("signout").addEventListener("click", async () => { await fetch("/auth/logout", { method: "POST" }); location.reload(); });

  // ---- Stay in step with studying elsewhere (Vox, ChatGPT, the iPhone app) ----
  let refreshing = false;
  async function refresh() {
    if (refreshing || document.visibilityState !== "visible" || $("app").hidden) return;
    // Never pull the page out from under something in progress.
    if (document.activeElement?.closest?.("input, textarea")) return;
    const drafting = [...$("cards").querySelectorAll("textarea")].some((field) => field.value.trim());
    refreshing = true;
    try {
      await loadDecks();
      if (!$("study-card").classList.contains("is-flipped")) await loadNext();
      if (openDeckId && !drafting && confirmId === null) await loadCards();
      await loadApps();
    } catch {
      // Try again on the next tick.
    } finally {
      refreshing = false;
    }
  }
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  setInterval(refresh, 30_000);

  // ---- Start ----
  (async () => {
    const response = await fetch("/api/me?offset=" + -new Date().getTimezoneOffset(), { cache: "no-store" });
    if (!response.ok) {
      $("signed-out").hidden = false;
      const demo = $("demo-card");
      demo.addEventListener("click", () => {
        const flipped = demo.classList.toggle("is-flipped");
        demo.querySelector(".face-front").setAttribute("aria-hidden", String(flipped));
        demo.querySelector(".face-back").setAttribute("aria-hidden", String(!flipped));
        demo.setAttribute("aria-label", flipped ? "Sample answer: 細胞質（cytosol）. Tap to see the question." : "Sample question: 糖解作用在細胞的哪裡進行？ Tap to see the answer.");
      });
      return;
    }
    const { user } = await response.json();
    $("who").textContent = user.name;
    $("account").hidden = false;
    $("app").hidden = false;
    await loadDecks();
    await Promise.all([loadNext(), loadCards(), loadApps()]);
  })().catch(fail);
})();`,
    appStyles,
  );
}

const statsStyles = `
  .stats { display: grid; gap: 1.25rem; padding: 1rem 0 3rem; }
  .stats > *, .pair > * { min-width: 0; }
  .stats h1 { margin: 0; font-size: 1.75rem; color: var(--text); }
  .stats .card h2 { margin: 0 0 .5rem; font-size: 1rem; color: var(--text); }
  .stats .card { padding: 3.25rem 1.5rem 1.5rem; }
  .card-label { position: absolute; top: 1.15rem; left: 1.5rem; right: 1.5rem; display: flex; justify-content: space-between; flex-wrap: wrap; gap: .4rem; font-size: .8125rem; color: var(--text-2); }
  .sentence { margin: 0 0 1.5rem; font-size: clamp(1.25rem, 2.4vw, 1.5rem); font-weight: 600; line-height: 1.4; letter-spacing: -.025em; color: var(--text); }
  .figures { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.25rem; }
  .figure { display: grid; align-content: start; gap: .4rem; }
  .figure b { display: block; font-size: 1.75rem; line-height: 1.25; font-weight: 650; letter-spacing: -.03em; color: var(--text); font-variant-numeric: tabular-nums; }
  .figure span { font-size: .8125rem; color: var(--text-2); }
  .pair { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 1.25rem; }
  .heat { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 16px); grid-auto-columns: 16px; justify-content: start; gap: 4px; overflow-x: auto; padding: .4rem 0; }
  .heat i, .heat-key i { border-radius: 3px; background: var(--line-soft); }
  :is(.heat, .heat-key) i[data-level="1"] { background: color-mix(in srgb, var(--accent) 22%, var(--field)); }
  :is(.heat, .heat-key) i[data-level="2"] { background: color-mix(in srgb, var(--accent) 44%, var(--field)); }
  :is(.heat, .heat-key) i[data-level="3"] { background: color-mix(in srgb, var(--accent) 70%, var(--field)); }
  :is(.heat, .heat-key) i[data-level="4"] { background: var(--accent); }
  .heat i.future { background: transparent; }
  .legend { display: flex; align-items: center; gap: .3rem; margin-top: .6rem; font-size: .75rem; color: var(--text-2); }
  .legend i { width: 11px; height: 11px; border-radius: 3px; }
  .bars { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); align-items: end; gap: .4rem; height: 170px; }
  .bar { display: grid; align-content: end; justify-items: center; gap: .3rem; height: 100%; font-size: .6875rem; color: var(--text-2); }
  .bar div { width: 100%; min-height: 2px; border-radius: 4px 4px 0 0; background: var(--accent); }
  .bar.today div { background: var(--ember); }
  .bar b { font-weight: 600; color: var(--text); font-size: .6875rem; }
  .stack { display: flex; gap: 0; height: 10px; overflow: hidden; border-radius: 999px; background: var(--field); }
  .stack span { display: block; height: 100%; }
  .key { display: flex; flex-wrap: wrap; gap: .4rem 1rem; margin-top: .75rem; font-size: .8125rem; color: var(--text-2); }
  .key i { display: inline-block; width: 10px; height: 10px; margin-right: .3rem; border-radius: 3px; }
  .deck-rows { display: grid; gap: 1rem; }
  .deck-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr) auto; gap: .5rem 1.25rem; align-items: center; }
  .deck-row .name { font-size: 1rem; font-weight: 500; color: var(--text); overflow-wrap: anywhere; }
  .deck-row .series { display: block; font-size: .75rem; color: var(--muted); }
  .deck-row .numbers { font-size: .8125rem; color: var(--text-2); text-align: right; }
  .slips { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
  .slip { padding: 3rem 1.15rem 1.15rem; }
  .slip .front { font-size: 1rem; line-height: 1.65; color: var(--text); }
  .slip .back { margin-top: .65rem; font-size: .9375rem; line-height: 1.65; color: var(--text-2); }
  .slip .meta { position: absolute; top: 1rem; left: 1.15rem; right: 1.15rem; display: flex; justify-content: space-between; gap: .5rem; font-size: .75rem; color: var(--muted); }
  .quiet { margin: 0; color: var(--text-2); }
  .section-head h2 { font-size: 1.25rem; color: var(--text); letter-spacing: -.02em; }
  @media (max-width: 820px) {
    .pair { grid-template-columns: 1fr; }
    .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .deck-row { grid-template-columns: 1fr auto; }
    .deck-row .stack { grid-column: 1 / -1; grid-row: 2; }
  }
  @media (max-width: 480px) {
    .stats .card { padding: 3.75rem 1rem 1.25rem; }
    .card-label { left: 1rem; right: 1rem; font-size: .75rem; }
    .bars { gap: 3px; height: 140px; }
    .heat { grid-template-rows: repeat(7, 13px); grid-auto-columns: 13px; gap: 3px; }
    .bar b { font-size: .625rem; }
  }
`;

/** Progress over time: activity, accuracy, what's coming due, and each deck's maturity. */
export function statsPage() {
  return shell(
    "Statistics – Vox Flash Cards",
    `<div class="wrap">
  <header class="topbar">
    <a class="wordmark" href="/"><span class="wordmark-mark" aria-hidden="true"></span>Vox Flash Cards</a>
    <div id="account" style="display:flex;align-items:center;gap:6px">
      <nav class="nav" aria-label="Pages"><a href="/">Study</a><a href="/stats" aria-current="page">Statistics</a></nav>
    </div>
  </header>
  <main class="stats" id="stats" aria-busy="true">
    <section class="card" aria-labelledby="summary-title">
      <span class="card-label"><span id="summary-title">Your progress</span><span id="today-label"></span></span>
      <p class="sentence" id="sentence">Loading your progress…</p>
      <div class="figures">
        <div class="figure"><b id="f-today">–</b><span>reviewed today</span></div>
        <div class="figure"><b id="f-accuracy">–</b><span>correct, last 30 days</span></div>
        <div class="figure"><b id="f-mature">–</b><span>cards learned well (3+ week interval)</span></div>
        <div class="figure"><b id="f-due">–</b><span>due now</span></div>
      </div>
    </section>

    <section class="card" aria-labelledby="activity-title">
      <span class="card-label"><span id="activity-title">Last 12 months</span><span id="activity-total"></span></span>
      <div class="heat" id="heat" role="img" aria-label="Reviews per day"></div>
      <div class="legend heat-key" aria-hidden="true">Fewer <i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i> More</div>
    </section>

    <div class="pair">
      <section class="card" aria-labelledby="forecast-title">
        <span class="card-label"><span id="forecast-title">Coming due, next 14 days</span></span>
        <div class="bars" id="bars" role="img" aria-label="Cards due per day"></div>
      </section>
      <section class="card" aria-labelledby="answers-title">
        <span class="card-label"><span id="answers-title">Your answers, last 30 days</span><span id="answers-total"></span></span>
        <div class="stack" id="answers" role="img"></div>
        <div class="key" id="answers-key"></div>
        <div style="margin-top:22px">
          <h2>All cards</h2>
          <div class="stack" id="maturity" role="img"></div>
          <div class="key" id="maturity-key"></div>
        </div>
      </section>
    </div>

    <section class="card" aria-labelledby="decks-title">
      <span class="card-label"><span id="decks-title">Decks</span><span>learned well of all cards</span></span>
      <div class="deck-rows" id="deck-rows"></div>
    </section>

    <section aria-labelledby="slips-title">
      <div class="section-head"><h2 id="slips-title">Cards that keep slipping</h2></div>
      <div class="slips" id="slips"></div>
    </section>
    <p class="error" id="error" role="alert"></p>
  </main>
</div>`,
    `(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key === "className") node.className = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
  };
  const number = (value) => new Intl.NumberFormat().format(value);
  const percent = (value) => value === null ? "–" : Math.round(value * 100) + "%";
  const addDays = (day, delta) => new Date(Date.parse(day + "T00:00:00Z") + delta * 86400000).toISOString().slice(0, 10);
  const dayLabel = (day, style) => new Date(day + "T00:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", ...style });
  const splitName = (name) => {
    const at = name.indexOf(": ");
    return at > 0 && at < 30 ? { series: name.slice(0, at), title: name.slice(at + 2) } : { series: "", title: name };
  };
  // Colors are the page's CSS tokens, so the bars match the grade buttons and dark mode.
  const MATURITY = [
    ["mature", "Learned well", "var(--accent)"],
    ["young", "Getting there", "color-mix(in srgb, var(--accent) 44%, var(--field))"],
    ["learning", "Learning", "var(--hard)"],
    ["new", "Not studied yet", "var(--new)"],
  ];
  const RATINGS = [["again", "Again", "var(--again)"], ["hard", "Hard", "var(--hard)"], ["good", "Good", "var(--good)"], ["easy", "Easy", "var(--easy)"]];

  function stack(target, keyTarget, parts, total, label) {
    $(target).replaceChildren(...parts.filter((part) => part.value > 0).map((part) =>
      el("span", { style: "width:" + (part.value / total) * 100 + "%;background:" + part.color, title: part.label + ": " + number(part.value) })));
    $(target).setAttribute("aria-label", label + ": " + parts.map((part) => part.label + " " + number(part.value)).join(", "));
    if (keyTarget) $(keyTarget).replaceChildren(...parts.map((part) =>
      el("span", {}, [el("i", { style: "background:" + part.color }), document.createTextNode(part.label + " " + number(part.value))])));
  }

  function render(stats) {
    const { totals } = stats;
    $("today-label").textContent = dayLabel(stats.today, { weekday: "long", month: "long", day: "numeric" });
    $("sentence").textContent = stats.streak > 1
      ? "You’ve studied " + stats.streak + " days in a row."
      : stats.streak === 1
        ? (stats.studiedToday ? "You studied today. Come back tomorrow to start a streak." : "You studied yesterday. Study today to keep it going.")
        : totals.cards
          ? "Grade a few cards today to start a streak."
          : "Add a deck to get started.";
    $("f-today").textContent = number(stats.studiedToday);
    $("f-accuracy").textContent = percent(stats.last30.accuracy);
    $("f-mature").textContent = number(totals.mature);
    $("f-due").textContent = number(totals.due);

    // Activity: one column per week, oldest first, ending with this week.
    const counts = new Map(stats.activity.map((row) => [row.day, row.reviews]));
    const max = Math.max(1, ...stats.activity.map((row) => row.reviews));
    const todayIndex = (new Date(stats.today + "T00:00:00Z").getUTCDay() + 6) % 7;
    const start = addDays(stats.today, -(stats.activityDays - 7 + todayIndex));
    const cells = [];
    for (let index = 0; index < stats.activityDays; index++) {
      const day = addDays(start, index);
      const future = day > stats.today;
      const reviews = counts.get(day) || 0;
      const level = reviews ? Math.min(4, Math.ceil((reviews / max) * 4)) : 0;
      cells.push(el("i", { className: future ? "future" : "", "data-level": String(level), title: future ? "" : dayLabel(day, { month: "short", day: "numeric" }) + ": " + reviews + " reviewed" }));
    }
    $("heat").replaceChildren(...cells);
    // Narrow screens scroll the year; start at the most recent weeks.
    $("heat").scrollLeft = $("heat").scrollWidth;
    const reviewedTotal = stats.activity.reduce((sum, row) => sum + row.reviews, 0);
    $("activity-total").textContent = reviewedTotal ? number(reviewedTotal) + " reviews over " + stats.daysStudied + (stats.daysStudied === 1 ? " day" : " days") : "Grade a card and it shows up here";

    // Forecast: overdue cards count toward today.
    const due = new Map(stats.forecast.map((row) => [row.day, row.due]));
    const forecastMax = Math.max(1, ...stats.forecast.map((row) => row.due));
    $("bars").replaceChildren(...Array.from({ length: 14 }, (_, index) => {
      const day = addDays(stats.today, index);
      const value = due.get(day) || 0;
      return el("div", { className: "bar" + (index === 0 ? " today" : ""), title: dayLabel(day, { month: "short", day: "numeric" }) + ": " + value + " due" }, [
        el("b", { text: value ? number(value) : "" }),
        el("div", { style: "height:" + (value ? Math.max(3, (value / forecastMax) * 120) : 0) + "px" }),
        el("span", { text: index === 0 ? "Today" : dayLabel(day, { weekday: "narrow" }) }),
      ]);
    }));

    const ratings = stats.last30.ratings;
    const answered = stats.last30.reviews;
    $("answers-total").textContent = answered ? number(answered) + " answers" : "";
    if (answered) {
      stack("answers", "answers-key", RATINGS.map(([key, label, color]) => ({ label, color, value: ratings[key] })), answered, "Answers");
    } else {
      $("answers").replaceChildren();
      $("answers-key").replaceChildren(el("p", { className: "quiet", text: "No answers yet in the last 30 days." }));
    }
    stack("maturity", "maturity-key", MATURITY.map(([key, label, color]) => ({ label, color, value: totals[key] })), Math.max(1, totals.cards), "All cards");

    $("deck-rows").replaceChildren(...(stats.decks.length ? stats.decks.map((deck) => {
      const name = splitName(deck.name);
      const bar = el("div", { className: "stack", role: "img" });
      bar.replaceChildren(...MATURITY.filter(([key]) => deck[key] > 0).map(([key, label, color]) =>
        el("span", { style: "width:" + (deck[key] / Math.max(1, deck.cards)) * 100 + "%;background:" + color, title: label + ": " + deck[key] })));
      bar.setAttribute("aria-label", MATURITY.map(([key, label]) => label + " " + deck[key]).join(", "));
      return el("div", { className: "deck-row" }, [
        el("div", { className: "name" }, [...(name.series ? [el("span", { className: "series", text: name.series })] : []), document.createTextNode(name.title)]),
        bar,
        el("div", { className: "numbers", text: number(deck.mature) + " of " + number(deck.cards) + (deck.accuracy30 === null ? "" : ", " + percent(deck.accuracy30) + " correct") }),
      ]);
    }) : [el("p", { className: "quiet", text: "No decks yet." })]));

    $("slips").replaceChildren(...(stats.hardest.length ? stats.hardest.map((card) => el("article", { className: "card slip" }, [
      el("span", { className: "meta" }, [el("span", { text: splitName(card.deck).title }), el("span", { text: "Forgot " + card.lapses + (card.lapses === 1 ? " time" : " times") })]),
      el("div", { className: "front", text: card.front }),
      el("div", { className: "back", text: card.back }),
    ])) : [el("p", { className: "quiet", text: "Nothing yet. Cards you forget more than once will collect here so you can give them extra attention." })]));
    $("stats").setAttribute("aria-busy", "false");
  }

  let loaded = false;
  async function load() {
    const response = await fetch("/api/stats?offset=" + -new Date().getTimezoneOffset(), { cache: "no-store" });
    if (response.status === 401) { location.replace("/"); return; }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.stats) throw new Error(payload.error || "Statistics are unavailable right now.");
    render(payload.stats);
    loaded = true;
    $("error").textContent = "";
  }
  load().catch((error) => { $("error").textContent = error.message; $("sentence").textContent = "Couldn’t load your progress."; });
  // Reviews made in Vox, ChatGPT, or the iPhone app show up without a reload.
  const refresh = () => { if (document.visibilityState === "visible" && loaded) load().catch(() => {}); };
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  setInterval(refresh, 60_000);
})();`,
    statsStyles,
  );
}
