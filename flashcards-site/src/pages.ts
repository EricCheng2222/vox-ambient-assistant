import { escapeHtml } from "./util.ts";

// Visual language: index cards on a desk. Cards are white paper with faint
// blue rules and one red rule at the top; the card face is hand-lettered
// (LXGW WenKai TC). Everything else stays quiet so the cards carry the page.

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&display=swap">`;

const baseStyles = `
  :root {
    color-scheme: light;
    --desk: #e3e8ee;
    --desk-deep: #d3dae3;
    --paper: #ffffff;
    --rule: #cfe0f2;
    --margin: #db4b3f;
    --ink: #1e2b45;
    --ink-soft: #55617a;
    --ink-faint: #8a94a8;
    --action: #2f55b5;
    --action-ink: #ffffff;
    --heading: #1e2b45;
    --chip: rgb(255 255 255 / 62%);
    --again: #c8453a;
    --hard: #b7791f;
    --good: #2f7d4f;
    --easy: #2f55b5;
    --shadow: 0 1px 1px rgb(30 43 69 / 8%), 0 8px 24px -12px rgb(30 43 69 / 28%);
    --hand: "LXGW WenKai TC", "Kaiti TC", "STKaiti", "DFKai-SB", serif;
    --ui: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --desk: #172233;
      --desk-deep: #121b29;
      --paper: #eef0ec;
      --rule: #c9d6e3;
      --ink: #1e2b45;
      --ink-soft: #b9c3d4;
      --ink-faint: #8391a8;
      --action: #8fb0ff;
      --action-ink: #0f1a33;
      --heading: #f1f3f7;
      --chip: rgb(255 255 255 / 9%);
      --shadow: 0 1px 1px rgb(0 0 0 / 30%), 0 12px 28px -12px rgb(0 0 0 / 60%);
    }
  }
  * { box-sizing: border-box; }
  html { background: var(--desk); }
  body { margin: 0; min-height: 100vh; font: 16px/1.55 var(--ui); color: var(--ink-soft); background: var(--desk); -webkit-font-smoothing: antialiased; }
  a { color: var(--action); }
  button, input, textarea { font: inherit; color: inherit; }
  button, a, .flip { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  :focus-visible { outline: 3px solid var(--action); outline-offset: 2px; }
  [hidden] { display: none !important; }

  .wrap { width: min(100% - 32px, 1080px); margin: 0 auto; padding-bottom: env(safe-area-inset-bottom); }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 0; }
  .wordmark { display: flex; align-items: center; gap: 10px; color: var(--ink-soft); font-weight: 600; text-decoration: none; }
  .wordmark-mark { position: relative; width: 26px; height: 19px; border-radius: 3px; background: var(--paper); box-shadow: var(--shadow); }
  .wordmark-mark::before { content: ""; position: absolute; inset: 5px 0 auto; height: 2px; background: var(--margin); }
  .wordmark-mark::after { content: ""; position: absolute; left: 3px; right: 3px; top: 10px; height: 5px; background: repeating-linear-gradient(to bottom, var(--rule) 0 1px, transparent 1px 4px); }

  /* The index card */
  .card { position: relative; background: var(--paper); border-radius: 6px; box-shadow: var(--shadow); color: var(--ink);
    background-image: linear-gradient(var(--margin), var(--margin)), repeating-linear-gradient(to bottom, transparent 0 31px, var(--rule) 31px 32px);
    background-size: 100% 2px, 100% 100%; background-position: 0 44px, 0 46px; background-repeat: no-repeat, repeat-y; }
  .hand { font-family: var(--hand); color: var(--ink); }

  .button { display: inline-flex; white-space: nowrap; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 20px; border: 0; border-radius: 10px; font-weight: 600; text-decoration: none; cursor: pointer; }
  .button-primary { color: var(--action-ink); background: var(--action); }
  .button-quiet { color: var(--ink-soft); background: transparent; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ink-soft) 35%, transparent); }
  .button:disabled { opacity: 0.45; cursor: default; }
  .link-button { padding: 4px 6px; border: 0; background: none; color: var(--ink-soft); cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 35%, transparent); text-underline-offset: 3px; }
  .link-button.danger { color: var(--again); }
  .nav { display: flex; gap: 4px; margin-right: 10px; }
  .nav a { padding: 6px 10px; border-radius: 8px; color: var(--ink-soft); font-weight: 600; text-decoration: none; }
  .nav a[aria-current="page"] { background: var(--chip); color: var(--heading); }
  @media (max-width: 480px) { .nav { margin-right: 0; } .who-name { display: none; } }
  .field { width: 100%; padding: 10px 12px; border: 1.5px solid color-mix(in srgb, var(--ink-faint) 45%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--paper) 85%, transparent); color: var(--ink); }
  .error { color: var(--again); min-height: 1.5em; }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

function shell(title: string, body: string, script = "", extraStyles = "") {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#e3e8ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#172233" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(title)}</title>
${fonts}
<style>${baseStyles}${extraStyles}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

const smallPageStyles = `
  .solo { width: min(100% - 32px, 460px); margin: 10vh auto 0; }
  .solo .card { padding: 58px 28px 28px; }
  .solo h1 { margin: 0 0 12px; font-family: var(--hand); font-size: 30px; font-weight: 700; line-height: 1.15; color: var(--ink); }
  .solo p, .solo li { color: #4a5670; line-height: 32px; margin: 0; }
  .solo ul { margin: 0; padding-left: 20px; }
  .solo .actions { display: grid; gap: 10px; margin-top: 24px; }
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
  /* Landing */
  .landing { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); gap: clamp(32px, 6vw, 88px); align-items: center; min-height: calc(100vh - 90px); padding-bottom: 48px; }
  .landing h1 { margin: 0 0 16px; font-family: var(--hand); font-size: clamp(38px, 6vw, 64px); font-weight: 700; line-height: 1.08; color: var(--heading); letter-spacing: -0.01em; }
  .landing p { max-width: 34em; margin: 0 0 28px; font-size: 18px; }
  .demo { perspective: 1400px; }
  .demo-hint { margin-top: 14px; font-size: 14px; color: var(--ink-faint); text-align: center; }

  /* Flip card */
  .flip { position: relative; display: block; width: 100%; aspect-ratio: 5 / 3; padding: 0; border: 0; background: none; cursor: pointer; transform-style: preserve-3d; transition: transform 520ms cubic-bezier(.2,.7,.2,1); text-align: left; }
  .flip.is-flipped { transform: rotateY(180deg); }
  .face { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 56px 28px 22px; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow-y: auto; overscroll-behavior: contain; }
  .face-back { transform: rotateY(180deg); }
  .face-text { margin: auto 0; font-family: var(--hand); font-size: clamp(22px, 3.2vw, 30px); line-height: 32px; color: var(--ink); overflow-wrap: anywhere; white-space: pre-wrap; }
  .study-stage .face-text.is-long { font-size: clamp(19px, 2.4vw, 23px); }
  .face-note { font-family: var(--hand); font-size: 17px; line-height: 32px; color: #5b6784; white-space: pre-wrap; }
  .face-corner { position: absolute; top: 14px; left: 28px; right: 28px; display: flex; justify-content: space-between; font-size: 13px; color: #8a94a8; }

  /* Today: the card is the centerpiece */
  .today { display: flex; flex-direction: column; align-items: center; width: min(100%, 720px); margin: 0 auto; padding: 4px 0 72px; }
  .today-head { display: grid; justify-items: center; gap: 12px; margin-bottom: 22px; text-align: center; max-width: 100%; }
  .today h1 { margin: 0; display: flex; align-items: baseline; gap: 10px; font-size: 17px; font-weight: 500; color: var(--ink-soft); }
  .due-number { font-family: var(--hand); font-size: 44px; line-height: 1; font-weight: 700; color: var(--heading); }
  .study-stage { position: relative; width: 100%; perspective: 1600px; }
  /* The rest of today's pile peeks out behind the card. */
  .study-stage::before, .study-stage::after { content: ""; position: absolute; inset: 0; border-radius: 6px; background: var(--paper); box-shadow: var(--shadow); opacity: 0; transition: opacity 200ms; }
  .study-stage::before { transform: translate(6px, 8px) rotate(1.4deg); }
  .study-stage::after { transform: translate(-5px, 5px) rotate(-1deg); }
  .study-stage.has-more::before, .study-stage.has-more::after { opacity: 1; }
  .study-stage .flip { z-index: 1; }
  .study-stage .face-text { font-size: clamp(24px, 3.4vw, 32px); }
  .grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; width: 100%; margin-top: 26px; }
  .grade { display: grid; gap: 2px; min-height: 60px; padding: 8px 6px; border: 0; border-radius: 10px; background: var(--paper); box-shadow: var(--shadow); cursor: pointer; color: var(--ink); font-weight: 600; }
  .grade small { font-weight: 500; font-size: 12px; color: #6b7690; }
  .grade[data-rating="again"] { box-shadow: inset 0 -3px 0 var(--again), var(--shadow); }
  .grade[data-rating="hard"] { box-shadow: inset 0 -3px 0 var(--hard), var(--shadow); }
  .grade[data-rating="good"] { box-shadow: inset 0 -3px 0 var(--good), var(--shadow); }
  .grade[data-rating="easy"] { box-shadow: inset 0 -3px 0 var(--easy), var(--shadow); }
  .reveal-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; margin-top: 26px; }
  .reveal-actions { display: flex; align-items: center; gap: 8px; }
  .keys { font-size: 13px; color: var(--ink-faint); }
  @media (hover: none) { .keys { visibility: hidden; } }
  .empty-card .face-text { font-size: 24px; }
  .scope { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
  .chip { padding: 6px 12px; border: 0; border-radius: 999px; background: var(--chip); color: var(--ink-soft); cursor: pointer; font-size: 14px; }
  .chip[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
  @media (prefers-color-scheme: dark) { .chip[aria-pressed="true"] { background: var(--paper); color: var(--ink); } }
  .vox-note { margin: 22px 0 0; font-size: 14px; color: var(--ink-faint); text-align: center; }

  /* Deck shelf */
  .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 0 0 18px; }
  .section-head h2 { margin: 0; font-size: 20px; color: var(--heading); }
  .shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 26px 20px; padding-bottom: 12px; }
  @media (max-width: 480px) { .shelf { grid-template-columns: 1fr 1fr; gap: 20px 14px; } .pile-name { font-size: 18px; } .pile .card { padding: 46px 12px 12px; } }
  .pile { position: relative; display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; text-align: left; }
  .pile .card { display: flex; flex-direction: column; justify-content: flex-end; min-height: 124px; padding: 50px 16px 14px; }
  .pile-name { font-family: var(--hand); font-size: 21px; line-height: 1.25; color: var(--ink); overflow-wrap: anywhere; }
  .pile-meta { margin-top: 6px; font-size: 13px; color: #6b7690; }
  .pile-series { position: absolute; top: 14px; left: 16px; right: 16px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; color: #8a94a8; }
  .pile-meta b { color: var(--again); font-weight: 600; }
  .pile-under { position: absolute; left: 0; right: 0; height: 100%; border-radius: 6px; background: var(--paper); box-shadow: var(--shadow); }
  .pile[aria-pressed="true"] .card { outline: 3px solid var(--action); outline-offset: 3px; }
  .new-deck .card { background-image: none; border: 2px dashed color-mix(in srgb, var(--ink-faint) 60%, transparent); background-color: transparent; box-shadow: none; justify-content: center; min-height: 124px; }
  .new-deck input { border: 0; border-bottom: 1.5px solid color-mix(in srgb, var(--ink-faint) 55%, transparent); border-radius: 0; background: transparent; padding: 6px 0; font-family: var(--hand); font-size: 19px; color: var(--ink-soft); width: 100%; }
  @media (prefers-color-scheme: dark) { .new-deck input { color: #f1f3f7; } }

  /* Deck view */
  .deck-view { padding: 36px 0 24px; }
  .deck-view h2 { margin: 0; font-family: var(--hand); font-size: 34px; color: var(--heading); }
  .deck-view .section-head { flex-wrap: wrap; align-items: center; }
  .deck-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
  .deck-tools .field { width: 220px; max-width: 100%; }
  .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 18px; margin-top: 22px; }
  .mini { display: flex; flex-direction: column; min-height: 178px; padding: 52px 18px 12px; }
  .mini-front { font-family: var(--hand); font-size: 19px; line-height: 32px; color: var(--ink); overflow-wrap: anywhere; white-space: pre-wrap; }
  .mini-back { font-family: var(--hand); font-size: 17px; line-height: 32px; color: #56627e; overflow-wrap: anywhere; white-space: pre-wrap; }
  .mini-tools { display: flex; justify-content: flex-end; gap: 4px; margin-top: auto; padding-top: 8px; font-size: 14px; }
  .mini-tools .link-button { color: #6b7690; }
  .mini-due { position: absolute; top: 12px; left: 18px; font-size: 12px; color: #8a94a8; }
  .composer textarea, .mini textarea { width: 100%; resize: vertical; min-height: 64px; border: 0; background: transparent; font-family: var(--hand); font-size: 19px; line-height: 32px; color: var(--ink); padding: 0; }
  .composer textarea::placeholder, .mini textarea::placeholder { color: #9aa3b5; }
  .composer .divider { height: 1px; margin: 4px 0 6px; background: color-mix(in srgb, var(--margin) 45%, transparent); }
  .composer-actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: auto; padding-top: 10px; }
  .muted-line { color: var(--ink-faint); font-size: 14px; }

  /* Apps */
  .apps { margin: 24px 0 64px; }
  .apps summary { cursor: pointer; font-weight: 600; color: var(--ink-soft); list-style: none; }
  .apps summary::-webkit-details-marker { display: none; }
  .apps summary::before { content: "+"; display: inline-block; width: 1.2em; color: var(--ink-faint); }
  .apps[open] summary::before { content: "–"; }
  .apps-body { max-width: 640px; margin-top: 12px; }
  .url-row { display: flex; gap: 8px; margin: 12px 0 18px; }
  .url-row code { flex: 1; min-width: 0; padding: 11px 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 8px; background: var(--chip); color: var(--ink-soft); font-size: 14px; }
  .app-list { margin: 0; padding: 0; list-style: none; }
  .app-list li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--ink-faint) 25%, transparent); }

  .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 16px; border-radius: 10px; background: var(--ink); color: #fff; font-size: 14px; box-shadow: var(--shadow); }
  @media (prefers-color-scheme: dark) { .toast { background: var(--paper); color: var(--ink); } }

  @media (max-width: 820px) {
    .landing { grid-template-columns: 1fr; min-height: 0; padding-top: 12px; }
    /* One swipeable row of decks instead of a tall wrapped block. */
    .scope { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; max-width: 100vw; margin: 0 -16px; padding: 0 16px 4px; scrollbar-width: none; }
    .scope::-webkit-scrollbar { display: none; }
    .chip { flex: none; min-height: 36px; }
  }
  @media (max-width: 600px) {
    .flip { aspect-ratio: auto; height: min(62vh, 420px); min-height: 300px; }
    .face { padding: 52px 20px 18px; }
    .study-stage .face-text { font-size: 24px; }
    .study-stage .face-text.is-long { font-size: 19px; }
    .today-head { margin-bottom: 16px; }
    .due-number { font-size: 36px; }
    .grades, .reveal-row { margin-top: 20px; }
    .grades { gap: 6px; }
    .grade { min-height: 62px; }
    .reveal-row .keys { display: none; }
    .reveal-row { justify-content: stretch; }
    .reveal-actions { width: 100%; }
    .reveal-actions .button { flex: 1; min-height: 52px; }
    .topbar { padding: 14px 0; }
    .deck-view h2 { font-size: 26px; }
    .deck-tools .field { width: 100%; }
    .cards-grid { grid-template-columns: 1fr; gap: 14px; }
    .apps { margin-bottom: 40px; }
  }
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
        <div class="face face-back card"><span class="face-corner"><span>生物化學</span><span>Back</span></span><div class="face-text">細胞質（cytosol）</div><div class="face-note">不需要氧氣；1 葡萄糖 → 2 丙酮酸，淨得 2 ATP 與 2 NADH</div></div>
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
          <div class="face face-back card"><span class="face-corner"><span id="card-deck-back"></span><span>Answer</span></span><div class="face-text" id="card-back"></div><div class="face-note" id="card-note"></div></div>
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
    const deckLabel = studyDeckId ? splitName(deckName(studyDeckId)).title : "All decks";
    $("card-deck").textContent = deckLabel;
    $("card-deck-back").textContent = deckLabel;
    $("card-side-front").textContent = result.repeat ? "Missed earlier, try again" : "Question";
    if (current) {
      $("card-front").textContent = current.front;
      $("card-back").textContent = current.back;
      $("card-front").classList.toggle("is-long", current.front.length > 70);
      $("card-back").classList.toggle("is-long", current.back.length > 70);
      $("card-note").textContent = current.notes || "";
      $("study-card").classList.remove("empty-card");
      $("study-card").setAttribute("aria-label", "Question: " + current.front + ". Tap to see the answer.");
    } else {
      $("study-card").classList.add("empty-card");
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
    try { clearError(); await tool("grade_card", { card_id: card.card_id, rating }); await Promise.all([loadNext(), loadDecks()]); }
    catch (error) { current = card; setFlipped(true); fail(error); }
  }

  async function skip() {
    if (!current) return;
    const card = current;
    current = null;
    try {
      clearError();
      await tool("skip_card", { card_id: card.card_id });
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
          ...(card.notes ? [el("div", { className: "mini-back", style: "font-size:15px;color:#7a849b", text: card.notes })] : []),
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
        }, [front, el("div", { className: "divider", "aria-hidden": "true", style: "height:1px;margin:4px 0 6px;background:rgb(219 75 63 / 45%)" }), back, notes,
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
    const input = el("input", { className: "field", value: deck.name, maxlength: "80", "aria-label": "Deck name", style: "font-family:var(--hand);font-size:24px;width:min(420px,100%)" });
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
      demo.addEventListener("click", () => demo.classList.toggle("is-flipped"));
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
  .stats { display: grid; gap: 28px; padding: 8px 0 72px; }
  .stats > *, .pair > * { min-width: 0; }
  .stats h1 { margin: 0; font-family: var(--hand); font-size: clamp(30px, 4vw, 40px); color: var(--heading); }
  .stats .card h2 { margin: 0 0 4px; font-size: 17px; color: var(--ink); }
  .stats .card { padding: 58px 24px 22px; }
  .card-label { position: absolute; top: 14px; left: 24px; right: 24px; display: flex; justify-content: space-between; font-size: 13px; color: #6b7690; }
  .sentence { margin: 0 0 18px; font-family: var(--hand); font-size: clamp(24px, 3.4vw, 34px); line-height: 1.3; color: var(--ink); }
  .figures { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
  .figure b { display: block; font-family: var(--hand); font-size: 36px; line-height: 1.1; color: var(--ink); }
  .figure span { font-size: 13px; color: #5b6784; }
  .pair { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 24px; }

  .heat { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 17px); grid-auto-columns: 17px; justify-content: start; gap: 4px; overflow-x: auto; padding: 6px 0 4px; }
  .heat i { border-radius: 4px; background: #e8edf3; }
  .heat i[data-level="1"] { background: #c7d6f0; }
  .heat i[data-level="2"] { background: #8fb0e8; }
  .heat i[data-level="3"] { background: #4f74cc; }
  .heat i[data-level="4"] { background: #2f55b5; }
  .heat i.future { background: transparent; }
  .legend { display: flex; align-items: center; gap: 4px; margin-top: 10px; font-size: 12px; color: #6b7690; }
  .legend i { width: 11px; height: 11px; border-radius: 3px; }

  .bars { display: grid; grid-template-columns: repeat(14, 1fr); align-items: end; gap: 6px; height: 170px; }
  .bar { display: grid; align-content: end; justify-items: center; gap: 4px; height: 100%; font-size: 11px; color: #6b7690; }
  .bar div { width: 100%; min-height: 2px; border-radius: 4px 4px 0 0; background: var(--easy); }
  .bar.today div { background: var(--margin); }
  .bar b { font-weight: 600; color: var(--ink); font-size: 11px; }

  .stack { display: flex; height: 14px; overflow: hidden; border-radius: 999px; background: #e8edf3; }
  .stack span { display: block; height: 100%; }
  .key { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 13px; color: #5b6784; }
  .key i { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 2px; }

  .deck-rows { display: grid; gap: 18px; }
  .deck-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr) auto; gap: 8px 20px; align-items: center; }
  .deck-row .name { font-family: var(--hand); font-size: 20px; color: var(--ink); overflow-wrap: anywhere; }
  .deck-row .series { display: block; font-family: var(--ui); font-size: 12px; color: #8a94a8; }
  .deck-row .numbers { font-size: 13px; color: #5b6784; text-align: right; white-space: nowrap; }

  .slips { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .slip { padding: 52px 18px 14px; }
  .slip .front { font-family: var(--hand); font-size: 18px; line-height: 32px; color: var(--ink); }
  .slip .back { font-family: var(--hand); font-size: 16px; line-height: 32px; color: #56627e; }
  .slip .meta { position: absolute; top: 12px; left: 18px; right: 18px; display: flex; justify-content: space-between; font-size: 12px; color: #8a94a8; }
  .quiet { margin: 0; color: #6b7690; }

  @media (max-width: 820px) {
    .pair { grid-template-columns: 1fr; }
    .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .deck-row { grid-template-columns: 1fr auto; }
    .deck-row .stack { grid-column: 1 / -1; grid-row: 2; }
  }
  @media (max-width: 480px) {
    .stats .card { padding: 54px 16px 18px; }
    .card-label { left: 16px; right: 16px; }
    .bars { gap: 3px; height: 140px; }
    .heat { grid-template-rows: repeat(7, 13px); grid-auto-columns: 13px; gap: 3px; }
    .bar b { font-size: 10px; }
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
      <div class="legend" aria-hidden="true">Fewer <i style="background:#e8edf3"></i><i style="background:#c7d6f0"></i><i style="background:#8fb0e8"></i><i style="background:#4f74cc"></i><i style="background:#2f55b5"></i> More</div>
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
  const MATURITY = [
    ["mature", "Learned well", "#2f55b5"],
    ["young", "Getting there", "#8fb0e8"],
    ["learning", "Learning", "#b7791f"],
    ["new", "Not studied yet", "#c9d2de"],
  ];
  const RATINGS = [["again", "Again", "#c8453a"], ["hard", "Hard", "#b7791f"], ["good", "Good", "#2f7d4f"], ["easy", "Easy", "#2f55b5"]];

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
