import { escapeHtml } from "./util.ts";

const baseStyles = `
  :root { color-scheme: dark; --bg: #0b0c14; --panel: #12131d; --line: rgb(255 255 255 / 10%); --muted: rgb(255 255 255 / 58%); --accent: #f4ff74; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; padding: 24px 16px 48px; font: 15px/1.5 "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif; color: #f3f3f7; background: var(--bg); }
  a { color: var(--accent); }
  h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }
  h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  p { margin: 0 0 12px; color: var(--muted); }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: 0.08em; }
  .dot { width: 28px; height: 28px; border-radius: 9px; background: var(--accent); }
  .panel { padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--panel); }
  input, textarea { width: 100%; padding: 10px 12px; border: 1px solid rgb(255 255 255 / 14%); border-radius: 12px; font: inherit; color: inherit; background: rgb(255 255 255 / 5%); }
  input:focus, textarea:focus, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button, .button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 16px; border: 0; border-radius: 999px; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
  .primary { color: #10111b; background: var(--accent); }
  .secondary { color: #f3f3f7; background: rgb(255 255 255 / 8%); }
  .ghost { padding: 6px 10px; color: var(--muted); background: transparent; font-weight: 500; }
  .danger { color: #ffaaa4; }
  button:disabled { opacity: 0.5; cursor: default; }
  .muted { color: var(--muted); font-size: 13px; }
  .error { color: #ffaaa4; }
  [hidden] { display: none !important; }
`;

function shell(title: string, body: string, script = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${baseStyles}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

export function messagePage(title: string, message: string, link?: { href: string; label: string }) {
  return shell(
    title,
    `<main class="panel" style="max-width:440px;margin:10vh auto">
  <div class="brand" style="margin-bottom:18px"><span class="dot" aria-hidden="true"></span>VOX FLASH CARDS</div>
  <h1 style="margin-bottom:8px">${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  ${link ? `<a class="button primary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>` : ""}
</main>`,
  );
}

/** Approval screen shown to a signed-in user when an MCP client asks for access. */
export function consentPage(input: { clientName: string; userName: string; returnHost: string; query: string }) {
  const name = escapeHtml(input.clientName);
  const data = JSON.stringify({ query: input.query }).replace(/</g, "\\u003c");
  return shell(
    `Allow ${input.clientName}?`,
    `<main class="panel" style="max-width:440px;margin:8vh auto">
  <div class="brand" style="margin-bottom:18px"><span class="dot" aria-hidden="true"></span>VOX FLASH CARDS</div>
  <h1 style="margin-bottom:8px">Allow ${name}?</h1>
  <p>Signed in as <strong>${escapeHtml(input.userName)}</strong> with your Vox account.</p>
  <p>${name} will be able to:</p>
  <ul class="muted" style="margin:0 0 14px;padding-left:18px">
    <li>See your decks and cards</li>
    <li>Add, edit, and delete cards and decks</li>
    <li>Quiz you and record your review progress</li>
  </ul>
  <p class="muted">You can disconnect it anytime on this site. You’ll return to ${escapeHtml(input.returnHost)}.</p>
  <div style="display:grid;gap:10px;margin-top:16px">
    <button class="primary" id="allow" type="button">Allow</button>
    <button class="secondary" id="deny" type="button">Cancel</button>
  </div>
  <p class="error" id="error" role="alert" style="margin-top:10px"></p>
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
      if (!response.ok || !result.redirect) throw new Error(result.error || "Could not finish connecting.");
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

/** The flash-card editor. Signed-out visitors see "Sign in with Vox". */
export function appPage(mcpUrl: string) {
  const data = JSON.stringify({ mcpUrl }).replace(/</g, "\\u003c");
  return shell(
    "Vox Flash Cards",
    `<div style="max-width:720px;margin:0 auto">
  <header style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px">
    <div class="brand"><span class="dot" aria-hidden="true"></span>VOX FLASH CARDS</div>
    <div id="account" hidden style="display:flex;align-items:center;gap:8px">
      <span class="muted" id="who"></span>
      <button class="ghost" id="signout" type="button">Sign out</button>
    </div>
  </header>

  <main id="signed-out" hidden class="panel" style="max-width:460px;margin:8vh auto 0">
    <h1 style="margin-bottom:8px">Your flash cards, with a study buddy</h1>
    <p>Make decks here, then ask Vox “let’s review my flash cards” and it will quiz you like a friend. Claude, ChatGPT, and other MCP apps can use your cards too.</p>
    <a class="button primary" href="/auth/login">Sign in with Vox</a>
  </main>

  <main id="app" hidden style="display:grid;gap:18px">
    <section class="panel">
      <h2>Decks</h2>
      <div id="decks" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      <form id="new-deck" style="display:flex;gap:8px;margin-top:12px">
        <input name="name" placeholder="New deck, e.g. Japanese" maxlength="80" aria-label="New deck name" required>
        <button class="secondary" type="submit">Add deck</button>
      </form>
    </section>

    <section class="panel" id="deck-panel" hidden>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">
        <h1 id="deck-title" style="font-size:20px"></h1>
        <div style="display:flex;gap:4px">
          <button class="ghost" id="rename-deck" type="button">Rename</button>
          <button class="ghost danger" id="delete-deck" type="button">Delete deck</button>
        </div>
      </div>
      <form id="new-card" style="display:grid;gap:8px">
        <input name="front" placeholder="Front — question or word" maxlength="500" aria-label="Card front" required>
        <input name="back" placeholder="Back — answer" maxlength="1000" aria-label="Card back" required>
        <input name="notes" placeholder="Note or memory hook (optional)" maxlength="1000" aria-label="Card note">
        <div><button class="primary" type="submit">Add card</button></div>
      </form>
      <input id="search" placeholder="Search this deck" aria-label="Search cards" style="margin-top:16px">
      <ul id="cards" style="list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px"></ul>
    </section>

    <section class="panel">
      <h2>Study with Vox</h2>
      <p>In Vox, open <strong>Flash cards</strong> and connect this site once. Then say “let’s review my flash cards” or 考我單字卡.</p>
      <h2 style="margin-top:18px">Use from other apps (MCP)</h2>
      <p>Add this server as a custom MCP connector in Claude, ChatGPT, or another MCP app. It will ask you to sign in with your Vox account and approve access.</p>
      <div style="display:flex;gap:8px;align-items:center">
        <code id="mcp-url" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:8px 10px;border-radius:10px;background:rgb(0 0 0 / 30%)"></code>
        <button class="secondary" id="copy" type="button">Copy</button>
      </div>
      <h2 style="margin-top:18px">Connected apps</h2>
      <ul id="apps" style="list-style:none;margin:0;padding:0;display:grid;gap:6px"></ul>
    </section>
    <p class="error" id="error" role="alert"></p>
  </main>
</div>
<script type="application/json" id="config">${data}</script>`,
    `(() => {
  const { mcpUrl } = JSON.parse(document.getElementById("config").textContent);
  const $ = (id) => document.getElementById(id);
  let decks = [];
  let deckId = null;
  let cards = [];
  let confirmId = null;

  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
  };

  async function tool(name, args = {}) {
    const response = await fetch("/api/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: name, arguments: args }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) { location.reload(); throw new Error("Signed out."); }
    if (!response.ok) throw new Error(payload.error || "Something went wrong.");
    return payload.result;
  }

  function fail(error) { $("error").textContent = error.message || String(error); }
  function clearError() { $("error").textContent = ""; }

  async function loadDecks(prefer) {
    decks = (await tool("list_decks")).decks;
    const wanted = prefer ?? deckId;
    deckId = decks.some((deck) => deck.id === wanted) ? wanted : decks[0]?.id ?? null;
    renderDecks();
    await loadCards();
  }

  function renderDecks() {
    $("decks").replaceChildren(...decks.map((deck) => el("button", {
      type: "button",
      class: deck.id === deckId ? "primary" : "secondary",
      "aria-pressed": String(deck.id === deckId),
      text: deck.name + " · " + deck.cardCount + (deck.dueCount ? " (" + deck.dueCount + " due)" : ""),
      onclick: () => { deckId = deck.id; confirmId = null; renderDecks(); loadCards().catch(fail); },
    })));
    if (!decks.length) $("decks").replaceChildren(el("p", { text: "No decks yet. Add one below." }));
    const deck = decks.find((candidate) => candidate.id === deckId);
    $("deck-panel").hidden = !deck;
    if (deck) $("deck-title").textContent = deck.name;
    $("delete-deck").textContent = confirmId === deckId ? "Tap again to delete all" : "Delete deck";
  }

  async function loadCards() {
    if (!deckId) { cards = []; renderCards(); return; }
    const query = $("search").value.trim();
    cards = (await tool("list_cards", { deck: deckId, limit: 200, ...(query ? { query } : {}) })).cards;
    renderCards();
  }

  function renderCards() {
    $("cards").replaceChildren(...cards.map((card) => {
      const item = el("li", { class: "panel", style: "padding:12px 14px" });
      const view = () => {
        item.replaceChildren(el("div", { style: "display:flex;gap:8px;align-items:flex-start" }, [
          el("div", { style: "flex:1;min-width:0" }, [
            el("div", { text: card.front, style: "font-weight:600" }),
            el("div", { text: card.back, class: "muted", style: "font-size:15px" }),
            ...(card.notes ? [el("div", { text: card.notes, class: "muted" })] : []),
          ]),
          el("button", { class: "ghost", type: "button", text: "Edit", onclick: edit }),
          el("button", {
            class: "ghost danger", type: "button",
            text: confirmId === card.id ? "Delete?" : "Delete",
            onclick: async () => {
              if (confirmId !== card.id) { confirmId = card.id; renderCards(); return; }
              try { clearError(); await tool("delete_card", { card_id: card.id }); confirmId = null; await loadDecks(); } catch (error) { fail(error); }
            },
          }),
        ]));
      };
      const edit = () => {
        const front = el("input", { value: card.front, maxlength: "500", "aria-label": "Front" });
        const back = el("input", { value: card.back, maxlength: "1000", "aria-label": "Back" });
        const notes = el("input", { value: card.notes || "", maxlength: "1000", placeholder: "Note (optional)", "aria-label": "Note" });
        item.replaceChildren(el("form", {
          style: "display:grid;gap:8px",
          onsubmit: async (event) => {
            event.preventDefault();
            try { clearError(); await tool("edit_card", { card_id: card.id, front: front.value, back: back.value, notes: notes.value }); await loadCards(); } catch (error) { fail(error); }
          },
        }, [front, back, notes, el("div", { style: "display:flex;gap:8px" }, [
          el("button", { class: "primary", type: "submit", text: "Save" }),
          el("button", { class: "ghost", type: "button", text: "Cancel", onclick: view }),
        ])]));
        front.focus();
      };
      view();
      return item;
    }));
    if (deckId && !cards.length) $("cards").replaceChildren(el("li", { class: "muted", text: "No cards here yet." }));
  }

  async function loadApps() {
    const response = await fetch("/api/connections", { cache: "no-store" });
    const payload = await response.json().catch(() => ({ apps: [] }));
    $("apps").replaceChildren(...(payload.apps || []).map((app) => el("li", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px" }, [
      el("span", { text: app.name + (app.lastUsedAt ? " · used " + new Date(app.lastUsedAt).toLocaleDateString() : "") }),
      el("button", {
        class: "ghost danger", type: "button", text: "Disconnect",
        onclick: async () => {
          await fetch("/api/connections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grantId: app.grantId }) });
          loadApps();
        },
      }),
    ])));
    if (!(payload.apps || []).length) $("apps").replaceChildren(el("li", { class: "muted", text: "None yet." }));
  }

  $("new-deck").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = event.target.name.value.trim();
    if (!name) return;
    try { clearError(); const { deck } = await tool("create_deck", { name }); event.target.reset(); await loadDecks(deck.id); } catch (error) { fail(error); }
  });
  $("new-card").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      clearError();
      await tool("add_cards", { deck: deckId, cards: [{ front: form.front.value, back: form.back.value, ...(form.notes.value.trim() ? { notes: form.notes.value } : {}) }] });
      form.reset();
      form.front.focus();
      await loadDecks();
    } catch (error) { fail(error); }
  });
  $("rename-deck").addEventListener("click", () => {
    const deck = decks.find((candidate) => candidate.id === deckId);
    if (!deck) return;
    const input = el("input", { value: deck.name, maxlength: "80", "aria-label": "Deck name" });
    const form = el("form", {
      style: "display:flex;gap:8px;flex:1",
      onsubmit: async (event) => {
        event.preventDefault();
        try { clearError(); await tool("update_deck", { deck: deck.id, name: input.value }); await loadDecks(deck.id); } catch (error) { fail(error); }
      },
    }, [input, el("button", { class: "primary", type: "submit", text: "Save" })]);
    $("deck-title").replaceChildren(form);
    input.focus();
  });
  $("delete-deck").addEventListener("click", async () => {
    if (confirmId !== deckId) { confirmId = deckId; renderDecks(); return; }
    try { clearError(); await tool("delete_deck", { deck: deckId }); confirmId = null; deckId = null; await loadDecks(); } catch (error) { fail(error); }
  });
  let searchTimer = 0;
  $("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadCards().catch(fail), 250); });
  $("copy").addEventListener("click", () => navigator.clipboard?.writeText(mcpUrl).then(() => { $("copy").textContent = "Copied"; }));
  $("signout").addEventListener("click", async () => { await fetch("/auth/logout", { method: "POST" }); location.reload(); });
  $("mcp-url").textContent = mcpUrl;

  (async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) { $("signed-out").hidden = false; return; }
    const { user } = await response.json();
    $("who").textContent = user.name;
    $("account").hidden = false;
    $("app").hidden = false;
    await Promise.all([loadDecks(), loadApps()]);
  })().catch(fail);
})();`,
  );
}
