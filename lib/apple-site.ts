/** Shared, dependency-free presentation for the Vox companion Workers.
 * Reading surfaces are solid; only navigation uses a translucent material.
 * Relative units let browser text sizing scale controls and spacing together. */
export const appleSiteStyles = `
  :root {
    color-scheme: light dark;
    --ui: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "PingFang TC", "Noto Sans TC", sans-serif;
    --ink: 29 29 31;
    --text: rgb(var(--ink));
    --text-2: #414147;
    --muted: #64646b;
    --line: #d7d7dd;
    --line-soft: #e8e8ed;
    --accent: #005fc7;
    --accent-soft: #eaf2ff;
    --sun: var(--accent);
    --gold: #d96b35;
    --ember: #b74636;
    --warn: #855100;
    --danger: #b32924;
    --success: #287342;
    --night: #f5f5f7;
    --glass: #fff;
    --glass-strong: #fff;
    --field: #fff;
    --chrome: rgb(245 245 247 / 90%);
    --shadow: 0 4px 20px -14px rgb(0 0 0 / 18%);
    --radius: 0.875rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: 245 245 247;
      --text-2: #d0d0d7;
      --muted: #aaaab5;
      --line: #41414a;
      --line-soft: #34343d;
      --accent: #86baff;
      --accent-soft: #253348;
      --warn: #f3c98a;
      --danger: #ffaaa0;
      --success: #9fe0b4;
      --night: #16161b;
      --glass: #232329;
      --glass-strong: #2a2a32;
      --field: #1c1c22;
      --chrome: rgb(22 22 27 / 92%);
      --shadow: 0 4px 20px -14px rgb(0 0 0 / 50%);
    }
  }
  * { box-sizing: border-box; }
  html { background: var(--night); scroll-padding-top: 5rem; }
  body {
    margin: 0; min-height: 100vh; min-height: 100dvh;
    font: 0.9375rem/1.5 var(--ui); color: var(--text); background: var(--night);
    -webkit-font-smoothing: antialiased; font-optical-sizing: auto;
  }
  a { color: var(--accent); text-underline-offset: 0.2em; }
  a:hover { text-decoration-thickness: 2px; }
  button, input, textarea, select { font: inherit; color: inherit; }
  button, a, summary, input, select { touch-action: manipulation; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  form, p { margin: 0; }
  [hidden] { display: none !important; }
  .wrap { width: min(calc(100% - 3rem), 66rem); margin: 0 auto; padding-bottom: max(3rem, env(safe-area-inset-bottom)); }
  .narrow { max-width: 40rem; }
  .topbar {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    min-height: 4.75rem; margin-bottom: 1.5rem;
    padding-top: env(safe-area-inset-top); border-bottom: 1px solid var(--line-soft);
  }
  .brand { display: inline-flex; align-items: center; gap: 0.6rem; min-height: 2.75rem; color: var(--text); font-size: 1rem; font-weight: 650; letter-spacing: -0.015em; text-decoration: none; }
  .brand svg { width: 2rem; height: 2rem; flex: none; }
  .brand span b { color: var(--text); font-weight: inherit; }
  .who { display: flex; align-items: center; gap: 0.5rem; color: var(--muted); font-size: 0.8125rem; }
  .who-name { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h1, h2, h3 { margin: 0; font-weight: 650; line-height: 1.25; }
  h1 { font-size: clamp(1.5rem, 3vw, 1.75rem); letter-spacing: -0.025em; overflow-wrap: anywhere; }
  h2 { font-size: 1.0625rem; letter-spacing: -0.015em; }
  h3 { font-size: 0.9375rem; letter-spacing: -0.005em; }
  .hud { margin: 0; color: var(--muted); font-size: 0.8125rem; font-weight: 600; letter-spacing: 0.01em; }
  .hud.amber { color: var(--warn); }
  .hud svg { width: 1rem; height: 1rem; margin-right: 0.4rem; vertical-align: -0.2rem; }
  .page-head { display: grid; gap: 0.5rem; max-width: 42rem; margin-bottom: 0.25rem; }
  .lede { max-width: 60ch; color: var(--text-2); font-size: 0.9375rem; line-height: 1.6; text-wrap: pretty; }
  .muted { color: var(--muted); }
  .stack { display: grid; gap: 1.25rem; }
  .panel { min-width: 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--glass); box-shadow: var(--shadow); }
  .panel-pad { padding: 1.5rem; }
  .panel-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding: 1rem 1.25rem; }
  .panel-head h2 { color: var(--text); font-size: 0.9375rem; }
  .note { display: flex; align-items: start; gap: 0.75rem; padding: 1rem 1.25rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--glass); }
  .note svg { width: 1.25rem; height: 1.25rem; flex: none; margin-top: 0.1rem; color: var(--accent); }
  .note p { margin-top: 0.25rem; color: var(--text-2); font-size: 0.8125rem; line-height: 1.6; }
  .note h3 { font-size: 0.875rem; }
  .btn { display: inline-flex; min-height: 2.25rem; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem 0.875rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--glass); color: var(--text); font-size: 0.875rem; font-weight: 550; line-height: 1.3; text-align: center; text-decoration: none; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease; }
  .btn:hover { background: var(--accent-soft); border-color: var(--accent); color: var(--text); text-decoration: none; }
  .btn:active:not(:disabled) { background: var(--accent-soft); }
  .btn svg { width: 1rem; height: 1rem; flex: none; }
  .btn-primary { border-color: transparent; background: #0066cc; color: #fff; }
  .btn-primary:hover, .btn-primary:active:not(:disabled) { background: #0056ad; border-color: transparent; color: #fff; }
  .btn-amber { border-color: var(--warn); color: var(--warn); }
  .btn-quiet { border-color: transparent; background: transparent; color: var(--muted); font-weight: 500; }
  .btn-quiet:hover { border-color: transparent; }
  .btn-danger { color: var(--danger); }
  .btn-danger:hover { color: var(--danger); }
  .btn-sm { font-size: 0.8125rem; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-row { display: flex; flex-wrap: wrap; gap: 0.625rem; }
  .dot { width: 0.45rem; height: 0.45rem; flex: none; border-radius: 50%; background: var(--success); }
  .dot.amber { background: var(--warn); }
  .chip { display: inline-flex; align-items: center; padding: 0.15rem 0.5rem; border-radius: 0.375rem; background: var(--accent-soft); color: var(--accent); font-size: 0.75rem; font-weight: 600; }
  .mono { display: grid; width: 2.5rem; height: 2.5rem; flex: none; place-items: center; border-radius: 0.6rem; background: var(--accent-soft); color: var(--accent); font-size: 1.0625rem; font-weight: 600; }
  .mono.big { width: 3rem; height: 3rem; font-size: 1.25rem; }
  .mono.small-text { font-size: 0.65rem; }
  .error { margin-top: 1rem; padding: 0.75rem 0.875rem; border: 1px solid var(--danger); border-radius: 0.6rem; background: var(--glass); color: var(--danger); font-size: 0.875rem; }
  .error:empty { display: none; }
  .rows { margin: 0; padding: 0; list-style: none; }
  .row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 0.875rem; padding: 1rem 1.25rem; border-top: 1px solid var(--line-soft); }
  .row-main { display: grid; gap: 0.375rem; min-width: 0; }
  .row-title { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; font-size: 0.9375rem; font-weight: 600; }
  .row-title .address { min-width: 0; overflow-wrap: anywhere; }
  .row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 0.75rem; color: var(--muted); font-size: 0.8125rem; }
  .row-meta .state { display: inline-flex; align-items: center; gap: 0.375rem; }
  .row-meta .state.amber { color: var(--warn); }
  .row-allow { margin-top: 0.375rem; }
  .row-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.375rem; }
  .empty { display: grid; gap: 0.875rem; justify-items: start; padding: 0.25rem 1.25rem 1.25rem; }
  .empty p { color: var(--muted); line-height: 1.6; }
  .code { display: block; margin-top: 0.5rem; padding: 0.625rem 0.75rem; overflow-wrap: anywhere; border: 1px solid var(--line-soft); border-radius: 0.5rem; background: var(--field); color: var(--text-2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.8125rem; }
  .section-foot { padding: 0.5rem 1.25rem 1.25rem; }
  .uses { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  .use { padding: 0.1rem 0.5rem; border-radius: 0.375rem; background: var(--accent-soft); color: var(--accent); font-size: 0.75rem; }
  .use.off { border: 1px dashed var(--line); background: transparent; color: var(--muted); }
  .figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); background: var(--line-soft); }
  .figure { display: grid; align-content: start; gap: 0.4rem; padding: 1.125rem 1.25rem; background: var(--glass); }
  .figure-label { color: var(--muted); font-size: 0.8125rem; font-weight: 500; }
  .figure-value { font-size: 1.75rem; font-weight: 650; line-height: 1.1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .figure-value small { margin-left: 0.2rem; color: var(--muted); font-size: 0.8125rem; font-weight: 500; letter-spacing: 0; }
  .figure-note { color: var(--muted); font-size: 0.75rem; overflow-wrap: anywhere; }
  .figure-note.warn { color: var(--warn); }
  .meter { height: 0.3rem; margin-top: 0.25rem; overflow: hidden; border-radius: 1rem; background: var(--line-soft); }
  .meter > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
  .week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.5rem; padding: 0.25rem 1.25rem 1rem; }
  .week-day { display: grid; gap: 0.4rem; justify-items: center; min-width: 0; }
  .week-bar { display: flex; width: 100%; max-width: 2rem; height: 5.25rem; align-items: flex-end; border-radius: 0.375rem; background: var(--line-soft); }
  .week-bar > span { display: block; width: 100%; min-height: 0.2rem; border-radius: inherit; background: var(--accent); }
  .week-bar.none > span { background: var(--line); }
  .week-count { min-height: 1.5em; font-size: 0.8125rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .week-name { color: var(--muted); font-size: 0.75rem; }
  .week-day.today .week-name { color: var(--accent); font-weight: 600; }
  .week-marks { display: flex; gap: 0.25rem; min-height: 0.375rem; }
  .week-marks i { width: 0.375rem; height: 0.375rem; border-radius: 50%; background: var(--muted); }
  .legend { display: flex; flex-wrap: wrap; gap: 0.375rem 1rem; padding: 0 1.25rem 1rem; color: var(--muted); font-size: 0.75rem; }
  .legend i { display: inline-block; width: 0.5rem; height: 0.5rem; margin-right: 0.375rem; border-radius: 50%; background: var(--muted); }
  .legend i.bar { border-radius: 0.15rem; background: var(--accent); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1rem; }
  .tile { display: grid; align-content: start; gap: 0.625rem; min-width: 0; padding: 1.25rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--glass); color: var(--text); text-decoration: none; }
  a.tile:hover { border-color: var(--accent); background: var(--glass-strong); color: var(--text); text-decoration: none; }
  .tile p { color: var(--text-2); font-size: 0.875rem; line-height: 1.6; }
  .tile .tile-foot { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; color: var(--accent); font-size: 0.875rem; font-weight: 600; }
  .tile .tile-foot svg { width: 1rem; height: 1rem; }
  .checks { display: grid; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
  .checks li { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); gap: 0.625rem; color: var(--text-2); line-height: 1.5; }
  .checks svg { width: 1.25rem; height: 1.25rem; color: var(--accent); }
  .checks li.amber svg { color: var(--warn); }
  .day { margin: 0; padding: 0 0 0.5rem; list-style: none; }
  .day li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem 1rem; align-items: baseline; padding: 0.875rem 1.25rem; border-top: 1px solid var(--line-soft); }
  .day .what { min-width: 0; overflow-wrap: anywhere; font-weight: 550; }
  .day .how { color: var(--text-2); font-size: 0.875rem; font-variant-numeric: tabular-nums; text-align: right; }
  .day .at { display: block; margin-bottom: 0.25rem; color: var(--muted); font-size: 0.75rem; font-weight: 400; font-variant-numeric: tabular-nums; }
  .hero { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.6fr); align-items: center; gap: 2rem; padding: 1rem 0 1.5rem; }
  .hero h1 { max-width: 18ch; font-size: clamp(1.75rem, 4vw, 2.5rem); letter-spacing: -0.035em; }
  .hero-copy { display: grid; gap: 1rem; }
  .reactor { justify-self: center; width: min(100%, 13rem); }
  .reactor svg { display: block; width: 100%; height: auto; }
  .cta { display: grid; gap: 0.625rem; justify-items: start; margin-top: 0.25rem; }
  .cta .muted { font-size: 0.8125rem; }
  .consent-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; }
  .consent-head .link { width: 2rem; height: 1px; background: var(--line); }
  label.field-label { display: block; margin: 1rem 0 0.375rem; color: var(--text-2); font-size: 0.875rem; font-weight: 600; }
  .field-hint { display: block; margin-top: 0.375rem; color: var(--muted); font-size: 0.8125rem; }
  .input, select.input { width: 100%; min-height: 2.75rem; padding: 0.625rem 0.75rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--field); color: var(--text); }
  select.input { appearance: auto; }
  select.input option { background: var(--field); color: var(--text); }
  .input:focus { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: 2px; }
  .grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 0.75rem; }
  details.advanced { margin-top: 1.125rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--field); }
  details.advanced summary { display: flex; min-height: 2.75rem; align-items: center; gap: 0.75rem; padding: 0.625rem 0.875rem; cursor: pointer; color: var(--text-2); font-weight: 600; list-style: none; }
  details.advanced summary::-webkit-details-marker { display: none; }
  details.advanced summary::before { content: ""; width: 0.4rem; height: 0.4rem; border-right: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); }
  details.advanced[open] summary::before { transform: rotate(45deg); }
  details.advanced .advanced-body { padding: 0 0.875rem 1rem; }
  .check { display: flex; gap: 0.75rem; align-items: center; min-height: 2.75rem; margin-top: 0.625rem; color: var(--text-2); font-size: 0.875rem; }
  .check input { width: 1.125rem; height: 1.125rem; flex: none; accent-color: var(--accent); }
  .form-actions { display: flex; flex-wrap: wrap; gap: 0.625rem; margin-top: 1.5rem; }
  .steps { display: grid; gap: 0.625rem; margin: 0.75rem 0 0; padding: 0; list-style: none; counter-reset: step; }
  .steps li { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); gap: 0.625rem; color: var(--text-2); font-size: 0.875rem; line-height: 1.6; counter-increment: step; }
  .steps li::before { content: counter(step); color: var(--accent); font-weight: 600; }
  .explain p:not(.hud) { color: var(--text-2); font-size: 0.875rem; line-height: 1.6; }
  .explain hr { width: 100%; height: 1px; margin: 0; border: 0; background: var(--line-soft); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .account-chip { display: inline-flex; align-items: center; gap: 0.5rem; max-width: 100%; padding: 0.4rem 0.75rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--field); font-size: 0.875rem; overflow-wrap: anywhere; }
  .account-chip b { min-width: 0; font-weight: 550; }
  .app-details { border: 1px solid var(--line); border-radius: var(--radius); background: var(--glass); }
  .app-details > summary { display: flex; align-items: center; justify-content: space-between; min-height: 3rem; padding: 0.875rem 1.25rem; font-weight: 600; cursor: pointer; }
  .app-details > summary::after { content: "+"; color: var(--muted); }
  .app-details[open] > summary::after { content: "−"; }
  @media (max-width: 859px) {
    .with-aside { grid-template-columns: minmax(0, 1fr) !important; }
    .row { grid-template-columns: auto minmax(0, 1fr); }
    .row-actions { grid-column: 2; justify-content: flex-start; }
  }
  @media (pointer: coarse), (max-width: 639px) { .btn { min-height: 2.75rem; } }
  @media (max-width: 639px) {
    body { font-size: 1rem; }
    .wrap { width: calc(100% - 2rem); }
    .topbar { min-height: 4rem; margin-bottom: 1.25rem; }
    .who-name { display: none; }
    .panel-pad { padding: 1.25rem; }
    .panel-head, .row, .empty, .section-foot, .day li { padding-left: 1rem; padding-right: 1rem; }
    .panel-head .btn { flex-shrink: 0; }
    .hero { grid-template-columns: minmax(0, 1fr); gap: 1rem; padding-top: 0.25rem; }
    .hero .reactor { display: none; }
    .grid-2 { grid-template-columns: minmax(0, 1fr); }
    .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .figure.wide { grid-column: 1 / -1; }
    .figure { padding: 1rem; }
    .figure-value { font-size: 1.625rem; }
    .week { gap: 0.25rem; padding-inline: 1rem; }
    .legend { padding-inline: 1rem; }
    .input, select.input { font-size: 1rem; }
    .row-actions { grid-column: 1 / -1; gap: 0.5rem; }
    .day li { grid-template-columns: minmax(0, 1fr); gap: 0.25rem; }
    .day .how { text-align: left; }
    .btn-row > .btn, .form-actions > .btn { flex: 1 1 auto; }
  }
  @media (prefers-reduced-transparency: reduce) { :root { --chrome: var(--night); } }
  @media (prefers-contrast: more) { :root { --muted: var(--text-2); --line: var(--text-2); --line-soft: var(--muted); } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
`;
