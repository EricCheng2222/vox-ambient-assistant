"use client";

import { useEffect, useRef, useState } from "react";

type Kind = "fine" | "can_fix" | "needs_you" | "needs_change" | "unknown";
type Finding = { id: string; title: string; kind: Kind; says: string; how?: string; fix?: string; undo?: string; report?: string };
type Report = { findings: Finding[]; summary: string; checkedAt: number; source: string | null };
type HealthBridge = {
  check: () => Promise<Report>;
  fix: (id: string) => Promise<{ done: boolean; says: string; finding?: Finding }>;
  chooseSource: () => Promise<{ source: string | null; error?: string }>;
  regression: () => Promise<{ passed: boolean; says: string; failed?: string[] }>;
  update: () => Promise<{ started: boolean; says: string }>;
  updateLog: () => Promise<{ lines: string[] }>;
};

const bridge = () => (typeof window === "undefined" ? null : ((window as { voxLocalCodex?: { health?: HealthBridge } }).voxLocalCodex?.health ?? null));

const LABEL: Record<Kind, string> = { fine: "Working", can_fix: "Vox can fix this", needs_you: "Needs you", needs_change: "Needs a change to Vox", unknown: "Could not be checked" };

/**
 * Vox checking on itself, on the Mac: what is working, what it can put right
 * with one tap, what only the user can do, and what is a fault in Vox itself.
 * Below that, for a Mac that has Vox's own source: the full run of checks, and
 * an update that only goes ahead when every one of them passes.
 */
export function HealthPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [checking, setChecking] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, string>>({});
  const [run, setRun] = useState<{ state: "idle" | "running" | "done"; passed?: boolean; says?: string; failed?: string[] }>({ state: "idle" });
  const [update, setUpdate] = useState<string[]>([]);
  const available = useRef(false);
  const [shown, setShown] = useState(false);

  async function check() {
    const health = bridge();
    if (!health) return;
    setChecking(true);
    try {
      setReport(await health.check());
    } catch {
      setReport(null);
    } finally {
      setChecking(false);
    }
  }

  // Only on the Mac app; a first check when the panel appears.
  useEffect(() => {
    available.current = bridge() !== null;
    const timer = window.setTimeout(() => {
      setShown(available.current);
      if (available.current) void check();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!shown) return null;
  const health = bridge()!;

  async function fix(item: Finding) {
    setFixing(item.id);
    try {
      const result = await health.fix(item.id);
      setSaid((current) => ({ ...current, [item.id]: result.says }));
      await check();
    } finally {
      setFixing(null);
    }
  }

  async function regression() {
    setRun({ state: "running" });
    try {
      const result = await health.regression();
      setRun({ state: "done", ...result });
    } catch {
      setRun({ state: "done", passed: false, says: "The checks could not be run." });
    }
  }

  async function startUpdate() {
    const result = await health.update();
    setUpdate([result.says]);
    if (!result.started) return;
    // Until the app is replaced under this page, say where the update has got to.
    const timer = window.setInterval(async () => {
      const log = await health.updateLog().catch(() => null);
      if (log?.lines.length) setUpdate(log.lines);
      if (log?.lines.some((line) => /^(Stopped|Done)/u.test(line))) window.clearInterval(timer);
    }, 4_000);
  }

  return (
    <section className="health" aria-label="Vox's health">
      <header className="health-head">
        <div>
          <h3>Health</h3>
          <p>{checking && !report ? "Checking…" : (report?.summary ?? "Vox could not check itself just now.")}</p>
        </div>
        <button type="button" className="health-button" onClick={() => void check()} disabled={checking}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </header>
      {report ? (
        <ul className="health-list">
          {report.findings.map((item) => (
            <li key={item.id} className="health-item" data-kind={item.kind}>
              <span className="health-dot" aria-hidden="true" />
              <div className="health-body">
                <p className="health-title">
                  {item.title} <span className="health-kind">{LABEL[item.kind]}</span>
                </p>
                <p className="health-says">{item.says}</p>
                {item.how ? <p className="health-how">What to do: {item.how}</p> : null}
                {item.kind === "can_fix" && item.fix ? (
                  <p className="health-fix">
                    <button type="button" className="health-button strong" onClick={() => void fix(item)} disabled={fixing !== null}>
                      {fixing === item.id ? "Fixing…" : item.fix}
                    </button>
                    {item.undo ? <span>{item.undo}</span> : null}
                  </p>
                ) : null}
                {said[item.id] ? <p className="health-result">{said[item.id]}</p> : null}
                {item.report ? (
                  <details className="health-report">
                    <summary>What was recorded</summary>
                    <pre>{item.report}</pre>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="health-update">
        <h4>Updating Vox</h4>
        {report?.source ? (
          <>
            <p>Vox only updates itself after every one of its checks has passed for the exact code it is about to install. The version running now is kept and put back if the new one does not start.</p>
            <p className="health-actions">
              <button type="button" className="health-button" onClick={() => void regression()} disabled={run.state === "running"}>
                {run.state === "running" ? "Running the checks…" : "Run all the checks"}
              </button>
              <button type="button" className="health-button strong" onClick={() => void startUpdate()} disabled={run.state === "running"}>
                Update Vox
              </button>
            </p>
            {run.state === "done" ? (
              <p className="health-result" data-passed={run.passed ? "" : undefined}>
                {run.says}
                {run.failed?.length ? ` (${run.failed.join(", ")})` : ""}
              </p>
            ) : null}
            {update.length ? (
              <ol className="health-steps">
                {update.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
            ) : null}
          </>
        ) : (
          <>
            <p>To run Vox’s full set of checks and update it from this Mac, tell Vox where its own source is kept.</p>
            <p className="health-actions">
              <button
                type="button"
                className="health-button"
                onClick={async () => {
                  const picked = await health.chooseSource();
                  if (picked.error) setSaid((current) => ({ ...current, source: picked.error! }));
                  await check();
                }}
              >
                Choose the folder
              </button>
            </p>
            {said.source ? <p className="health-result">{said.source}</p> : null}
          </>
        )}
      </div>
    </section>
  );
}
