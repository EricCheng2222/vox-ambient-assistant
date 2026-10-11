"use client";

import type { CheckInItem, CheckInReply } from "@/lib/check-in";

/**
 * The check-in on Talk: the few things Vox wants settled, each a question
 * with one-tap answers. Answering sends the reply as the user's own words.
 * Each can also be put off for a few hours, or switched off for good.
 */
export function CheckIn({
  items,
  more,
  disabled,
  onReply,
  onLater,
  onNever,
}: {
  items: CheckInItem[];
  /** How many more are waiting behind these. */
  more: number;
  disabled?: boolean;
  onReply: (item: CheckInItem, reply: CheckInReply) => void;
  /** Not now: it comes back in a few hours if it still matters. */
  onLater: (item: CheckInItem) => void;
  /** Never again: this notice (or this kind of notice) stays away. */
  onNever: (item: CheckInItem) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="check-in" aria-label="Vox would like to check with you">
      <ul>
        {items.map((item) => (
          <li key={item.id} className="check-in-item" data-kind={item.kind}>
            <div className="check-in-head">
              <p className="check-in-question">{item.question}</p>
            </div>
            {item.detail ? <p className="check-in-detail">{item.detail}</p> : null}
            <div className="check-in-replies">
              {item.replies.map((reply) => (
                <button key={reply.label} type="button" className="check-in-reply" disabled={disabled} onClick={() => onReply(item, reply)}>
                  {reply.label}
                </button>
              ))}
              <span className="check-in-quiet">
                <button type="button" onClick={() => onLater(item)} title="Hide this for three hours">
                  Later
                </button>
                <button type="button" onClick={() => onNever(item)} title="Never show this again">
                  Don’t show again
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="check-in-more">{more === 1 ? "One more after these." : `${more} more after these.`}</p> : null}
    </section>
  );
}
