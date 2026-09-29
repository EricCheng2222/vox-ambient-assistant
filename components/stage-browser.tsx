"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, RotateCw } from "lucide-react";

import { stageBrowserBridge, type StageBrowserState } from "@/lib/stage-browser";

/**
 * The live page inside the stage (Mac app). The page itself is a native view
 * the app lays over this box, so it is hidden whenever anything could sit on
 * top of it: another view, an open panel or dialog, or a hidden window.
 */
export function StageBrowser({ url, hidden }: { url: string; hidden: boolean }) {
  const [bridge] = useState(() => stageBrowserBridge());
  const slotRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<StageBrowserState>(null);
  const [covered, setCovered] = useState(false);

  useEffect(() => bridge?.onState(setState), [bridge]);

  useEffect(() => {
    if (bridge && url) void bridge.open(url).catch(() => undefined);
  }, [bridge, url]);

  // Panels, sheets, and dialogs render in portals above the page; the native
  // browser would cover them, so it steps aside while any is open.
  useEffect(() => {
    const check = () =>
      setCovered(Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [data-slot="sheet-content"]')));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "role"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const slot = slotRef.current;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot?.getBoundingClientRect();
        const visible = Boolean(rect) && !hidden && !covered && document.visibilityState === "visible";
        void bridge
          .layout(visible, rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : { x: 0, y: 0, width: 0, height: 0 })
          .catch(() => undefined);
      });
    };
    report();
    const resize = new ResizeObserver(report);
    if (slot) resize.observe(slot);
    window.addEventListener("resize", report);
    window.addEventListener("scroll", report, true);
    document.addEventListener("visibilitychange", report);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", report);
      window.removeEventListener("scroll", report, true);
      document.removeEventListener("visibilitychange", report);
      void bridge.layout(false, { x: 0, y: 0, width: 0, height: 0 }).catch(() => undefined);
    };
  }, [bridge, hidden, covered]);

  if (!bridge) return null;
  const shownUrl = state?.url || url;
  let host = shownUrl;
  try {
    const parsed = new URL(shownUrl);
    host = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    // Show it as it is.
  }

  return (
    <div className="vx-browser">
      <div className="vx-browser-bar">
        <button
          type="button"
          className="vx-browser-button"
          aria-label="Back"
          disabled={!state?.canGoBack}
          onClick={() => void bridge.command("back")}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vx-browser-button"
          aria-label="Forward"
          disabled={!state?.canGoForward}
          onClick={() => void bridge.command("forward")}
        >
          <ArrowRight aria-hidden="true" />
        </button>
        <button type="button" className="vx-browser-button" aria-label="Reload" onClick={() => void bridge.command("reload")}>
          {state?.loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RotateCw aria-hidden="true" />}
        </button>
        <span className="vx-browser-address" title={shownUrl}>
          {host}
        </span>
        <button type="button" className="vx-browser-button vx-browser-external" onClick={() => void bridge.command("external")}>
          <ExternalLink aria-hidden="true" /> Safari
        </button>
      </div>
      <div ref={slotRef} className="vx-browser-slot" aria-label={state?.title || "Web page"} role="region">
        {covered ? <p className="vx-browser-paused">The page is hidden while a panel is open.</p> : null}
      </div>
    </div>
  );
}
