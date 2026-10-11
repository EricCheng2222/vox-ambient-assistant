"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CornerDownLeft, Delete, RefreshCw, X } from "lucide-react";
import type { RemotePageInput, RemotePageView } from "@/lib/remote-control";

/**
 * The page open in the Mac's browser, shown on this phone or tablet as a live
 * picture the user works with their own hands: their taps, drags and typing
 * are passed to the page as they are. For the steps Vox must leave to a
 * person: a "confirm you are human" check, a puzzle, a choice only they can make.
 */
export function RemotePage({
  reason,
  request,
  onClose,
  onDone,
}: {
  /** Why this is on screen, in the user's words ("booking.com wants to check you are a person"). */
  reason: string;
  /** Sends what the user did (or nothing, for a fresh picture) and resolves with the page as it looks afterwards. */
  request: (input: RemotePageInput | undefined, size: [number, number]) => Promise<RemotePageView>;
  onClose: () => void;
  /** The user has done their part: Vox may carry on. */
  onDone: () => void;
}) {
  const [view, setView] = useState<RemotePageView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const busyRef = useRef(false);
  const alive = useRef(true);
  const pressed = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Always the latest way to ask, without restarting the timer below when the parent redraws.
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);
  const sendRef = useRef<(input?: RemotePageInput) => Promise<void>>(async () => undefined);
  useEffect(() => {
    sendRef.current = async (input) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        // The Mac lays the page out at the size of this frame, so it arrives readable and finger-sized.
        const frame = frameRef.current;
        const next = await requestRef.current(input, [frame?.clientWidth || 390, frame?.clientHeight || 640]);
        if (!alive.current) return;
        setView(next);
        setError("");
      } catch (failure) {
        if (alive.current) setError(failure instanceof Error && failure.message ? failure.message : "The Mac did not answer.");
      } finally {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    };
  });
  const send = (input?: RemotePageInput) => sendRef.current(input);

  // A first picture, then a fresh one every few seconds: pages change by themselves (a check that clears, a page that loads).
  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => void sendRef.current(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void sendRef.current();
    }, 4_000);
    return () => {
      alive.current = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const spot = (event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  };

  // On top of everything, whatever the conversation's own layout does.
  return createPortal(
    <section className="remote-page" role="dialog" aria-label="The page on your Mac">
      <header className="remote-page-head">
        <div>
          <p className="remote-page-title">On your Mac</p>
          <p className="remote-page-reason">{reason}</p>
        </div>
        <button type="button" className="remote-page-icon" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>
      <div ref={frameRef} className="remote-page-frame" data-busy={busy ? "" : undefined}>
        {view ? (
          // eslint-disable-next-line @next/next/no-img-element -- a picture of the user's own Mac, sent through the encrypted relay
          <img
            src={`data:image/jpeg;base64,${view.image}`}
            width={view.width}
            height={view.height}
            alt={`The page open on your Mac: ${view.title}`}
            draggable={false}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pressed.current = spot(event);
            }}
            onPointerUp={(event) => {
              const from = pressed.current;
              pressed.current = null;
              if (!from) return;
              const to = spot(event);
              const box = event.currentTarget.getBoundingClientRect();
              // A finger that travelled is a drag (a slider puzzle); one that stayed is a tap.
              const moved = Math.hypot((to.x - from.x) * box.width, (to.y - from.y) * box.height) > 14;
              void send(moved ? { type: "drag", from: [from.x, from.y], to: [to.x, to.y] } : { type: "tap", x: to.x, y: to.y });
            }}
            onPointerCancel={() => {
              pressed.current = null;
            }}
          />
        ) : (
          <p className="remote-page-waiting">{error || "Getting the page from your Mac…"}</p>
        )}
      </div>
      {view && error ? <p className="remote-page-error" role="alert">{error}</p> : null}
      <p className="remote-page-hint">Tap or drag on the picture as you would on the page. It updates a moment after each touch.</p>
      <div className="remote-page-tools">
        <button type="button" className="remote-page-icon" onClick={() => void send({ type: "scroll", down: false })} aria-label="Scroll up">
          <ArrowUp size={17} />
        </button>
        <button type="button" className="remote-page-icon" onClick={() => void send({ type: "scroll", down: true })} aria-label="Scroll down">
          <ArrowDown size={17} />
        </button>
        <form
          className="remote-page-type"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text) return;
            void send({ type: "text", text });
            setText("");
          }}
        >
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Type into the page" aria-label="Type into the page" autoCapitalize="off" autoCorrect="off" enterKeyHint="send" />
        </form>
        <button type="button" className="remote-page-icon" onClick={() => void send({ type: "key", key: "Backspace" })} aria-label="Delete a character">
          <Delete size={17} />
        </button>
        <button type="button" className="remote-page-icon" onClick={() => void send({ type: "key", key: "Enter" })} aria-label="Press Enter">
          <CornerDownLeft size={17} />
        </button>
        <button type="button" className="remote-page-icon" onClick={() => void send()} aria-label="Refresh the picture">
          <RefreshCw size={16} />
        </button>
      </div>
      <button type="button" className="remote-page-done" onClick={onDone}>
        I’ve done it, carry on
      </button>
    </section>,
    document.body,
  );
}
