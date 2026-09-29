"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ExternalLink, X } from "lucide-react";

import type { StageBlock, StageContent, StagePage } from "@/lib/stage";

export type StageAction = { label: string; onClick: () => void; primary?: boolean };

export type StageViewProps = {
  stage: StageContent;
  /** Reader view of the active source, or null while it has not been fetched. */
  page: StagePage | null;
  pageLoading: boolean;
  /** Index into `stage.sources`. */
  activeSource: number;
  onSelectSource: (index: number) => void;
  /** Open a source in the browser (or Safari on the Mac). */
  onOpenSource: (url: string) => void;
  onClose: () => void;
  /** Vox is speaking right now. */
  speaking: boolean;
  /** The words Vox is currently saying; the caption bar is hidden when empty. */
  caption?: string | null;
  actions?: StageAction[];
};

// --- Untrusted text ---------------------------------------------------------

/** Plain text from an untrusted page string: no control or bidi-override characters. */
function plain(text: string | null | undefined, max = 2000): string {
  if (!text) return "";
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) out += " ";
    else if (code < 32 || code === 127 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
    else out += char;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** "kmu.edu.tw / admissions / exam" from a URL. */
function pathLine(url: string, site: string) {
  const host = plain(site, 80);
  try {
    const segments = new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 4)
      .map((segment) => {
        try {
          return plain(decodeURIComponent(segment), 40);
        } catch {
          return plain(segment, 40);
        }
      })
      .filter(Boolean);
    return [host, ...segments].join(" / ");
  } catch {
    return host;
  }
}

function pad(count: number) {
  return String(count).padStart(2, "0");
}

// --- Blocks -----------------------------------------------------------------

function Block({ block, id }: { block: StageBlock; id: string }) {
  if (block.kind === "quote") {
    return (
      <div className="vx-block">
        <figure className="vx-quote">
          <blockquote>
            <p>{plain(block.text)}</p>
          </blockquote>
          {block.source ? <figcaption>{plain(block.source, 200)}</figcaption> : null}
        </figure>
      </div>
    );
  }

  const title = plain(block.title, 120);
  const heading = title ? (
    <h3 id={id} className="vx-hud">
      {title}
    </h3>
  ) : null;
  const labelledBy = title ? id : undefined;

  if (block.kind === "facts") {
    return (
      <section className="vx-block" aria-labelledby={labelledBy}>
        {heading}
        <dl className="vx-facts">
          {block.rows.map((row, index) => (
            <div key={index}>
              <dt>{plain(row.label, 200)}</dt>
              <dd>{plain(row.value, 400)}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  if (block.kind === "table") {
    return (
      <section className="vx-block" aria-labelledby={labelledBy}>
        {heading}
        <div className="vx-table-wrap" role="region" aria-label={title || "Table"} tabIndex={0}>
          <table className="vx-table">
            {block.columns.length > 0 ? (
              <thead>
                <tr>
                  {block.columns.map((column, index) => (
                    <th key={index} scope="col">
                      {plain(column, 120)}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{plain(cell, 400)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (block.kind === "steps") {
    return (
      <section className="vx-block" aria-labelledby={labelledBy}>
        {heading}
        <ol className="vx-steps">
          {block.items.map((item, index) => (
            <li key={index}>
              <span className="vx-mono" aria-hidden="true">
                {pad(index + 1)}
              </span>
              <span>{plain(item, 600)}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  // list: short items read best as chips, longer ones as a bulleted list.
  const items = block.items.map((item) => plain(item, 600)).filter(Boolean);
  const chips = items.length <= 12 && items.every((item) => item.length <= 28);
  return (
    <section className="vx-block" aria-labelledby={labelledBy}>
      {heading}
      <ul className="vx-list" data-style={chips ? "chips" : "bullets"}>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function Reactor() {
  const gradientId = `${useId()}-core`;
  return (
    <svg className="vx-stage-reactor" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.3" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="189" fill="none" stroke="currentColor" strokeWidth="12" strokeDasharray="1.4 8.5" opacity="0.45" />
      <g className="vx-spin vx-spin-rev">
        <circle
          cx="200"
          cy="200"
          r="160"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeDasharray="28 4 6 4 52 10 3 3 3 22 40 6 18 4 60 12 22 63"
          opacity="0.6"
        />
      </g>
      <g className="vx-spin">
        <circle
          cx="200"
          cy="200"
          r="136"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="92 88 64 116"
          pathLength="360"
          opacity="0.9"
        />
      </g>
      <circle cx="200" cy="200" r="100" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.5" />
      <circle cx="200" cy="200" r="82" fill={`url(#${gradientId})`} />
    </svg>
  );
}

// --- Stage ------------------------------------------------------------------

/**
 * What Vox puts on screen while it explains something: the sources it used
 * (as tabs, with a reader view of the active one) and the facts it pulled
 * out. All page text is untrusted and rendered as plain text.
 */
export function StageView({
  stage,
  page,
  pageLoading,
  activeSource,
  onSelectSource,
  onOpenSource,
  onClose,
  speaking,
  caption,
  actions = [],
}: StageViewProps) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [brokenImages, setBrokenImages] = useState<string[]>([]);

  const sources = stage.sources;
  const hasSources = sources.length > 0;
  const activeIndex = hasSources ? Math.min(Math.max(0, Math.trunc(activeSource) || 0), sources.length - 1) : -1;
  const source = hasSources ? sources[activeIndex] : null;
  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = `${baseId}-panel`;
  const titleId = `${baseId}-title`;

  const status = speaking ? "Speaking" : "On stage";
  const hud = hasSources ? `${status} / ${sources.length} ${sources.length === 1 ? "source" : "sources"}` : status;

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!hasSources) return;
    let next = activeIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (activeIndex + 1) % sources.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (activeIndex - 1 + sources.length) % sources.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sources.length - 1;
    else return;
    event.preventDefault();
    if (next !== activeIndex) onSelectSource(next);
    tabRefs.current[next]?.focus();
  }

  // Reader content for the active source.
  const showPage = Boolean(page) && !pageLoading;
  const openUrl = httpUrl(showPage && page ? page.url : source?.url) ?? httpUrl(source?.url);
  const readerTitle = plain((showPage && page?.title) || source?.title, 300);
  const imageCandidate = httpUrl((showPage ? page?.image : null) ?? source?.image);
  const image = imageCandidate && !brokenImages.includes(imageCandidate) ? imageCandidate : null;
  const paragraphs = showPage && page ? page.paragraphs.map((text) => plain(text)).filter(Boolean) : [];
  const description = showPage && page ? plain(page.description, 600) : "";
  const showDescription = Boolean(description) && !paragraphs.slice(0, 2).some((text) => text.startsWith(description.slice(0, 60)));
  const excerpt = plain(source?.excerpt, 1200);

  const primaryActions = actions.filter((action) => action.primary);
  const otherActions = actions.filter((action) => !action.primary);
  const hasSide = stage.blocks.length > 0 || actions.length > 0;

  return (
    <section
      className="vx-stage"
      aria-labelledby={titleId}
      data-speaking={speaking ? "true" : "false"}
      data-has-sources={hasSources ? "true" : "false"}
    >
      <header className="vx-stage-head">
        <Reactor />
        <div className="vx-stage-heading">
          <p className="vx-hud">{hud}</p>
          <h2 id={titleId} className="vx-stage-title">
            {plain(stage.title, 300)}
          </h2>
        </div>
        <button type="button" className="vx-btn" onClick={onClose}>
          <X aria-hidden="true" /> Close
        </button>
      </header>

      {hasSources ? (
        <div className="vx-tabs" role="tablist" aria-label="Sources" onKeyDown={onTabKeyDown}>
          {sources.map((item, index) => {
            const selected = index === activeIndex;
            return (
              <button
                key={`${item.url}-${index}`}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={tabId(index)}
                className="vx-source-tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                title={plain(item.title, 200) || undefined}
                onClick={() => onSelectSource(index)}
              >
                <span className="vx-mono" aria-hidden="true">
                  {pad(index + 1)}
                </span>
                <span>{plain(item.site, 60) || plain(item.title, 60)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="vx-stage-body">
        {source ? (
          <section className="vx-reader" id={panelId} role="tabpanel" aria-labelledby={tabId(activeIndex)}>
            <span className="vx-bracket vx-bracket-tl" aria-hidden="true" />
            <span className="vx-bracket vx-bracket-br" aria-hidden="true" />
            <div className="vx-reader-bar">
              <span className="vx-favicon" aria-hidden="true">
                {plain(source.site, 80).charAt(0) || "·"}
              </span>
              <span className="vx-reader-path" title={openUrl ?? undefined}>
                {pathLine(openUrl ?? source.url, source.site)}
              </span>
              {openUrl ? (
                <button type="button" className="vx-btn" onClick={() => onOpenSource(openUrl)}>
                  <ExternalLink aria-hidden="true" /> Open in browser
                </button>
              ) : null}
            </div>
            <div className="vx-reader-scroll" tabIndex={0} aria-label={readerTitle || "Page"}>
              {readerTitle ? <h3 className="vx-reader-title">{readerTitle}</h3> : null}
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote page images of unknown hosts
                <img
                  key={image}
                  className="vx-reader-image"
                  src={image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setBrokenImages((list) => (list.includes(image) ? list : [...list, image]))}
                />
              ) : null}
              {showPage ? (
                <>
                  {showDescription ? <p className="vx-reader-lede">{description}</p> : null}
                  {paragraphs.map((text, index) => (
                    <p key={index}>{text}</p>
                  ))}
                  {!showDescription && paragraphs.length === 0 ? (
                    excerpt ? (
                      <p className="vx-excerpt">{excerpt}</p>
                    ) : (
                      <p className="vx-reader-note">This page has no readable text. Open it in the browser to see it.</p>
                    )
                  ) : null}
                </>
              ) : (
                <>
                  {excerpt ? <p className="vx-excerpt">{excerpt}</p> : null}
                  {pageLoading ? (
                    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                      <div className="vx-skeleton" style={{ height: "0.85rem" }} />
                      <div className="vx-skeleton" style={{ height: "0.85rem", width: "92%" }} />
                      <div className="vx-skeleton" style={{ height: "0.85rem", width: "78%" }} />
                      <div className="vx-skeleton" style={{ height: "0.85rem", width: "86%" }} />
                    </div>
                  ) : !excerpt ? (
                    <p className="vx-reader-note">Vox hasn’t opened this page yet.</p>
                  ) : null}
                  {pageLoading ? (
                    <p className="sr-only" role="status">
                      Opening the page…
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </section>
        ) : null}

        {hasSide ? (
          <div className="vx-blocks" aria-label="What Vox pulled out" role="group">
            {stage.blocks.length > 0 ? (
              <div className="vx-blocks-grid">
                {stage.blocks.map((block, index) => (
                  <Block key={index} block={block} id={`${baseId}-block-${index}`} />
                ))}
              </div>
            ) : null}
            {actions.length > 0 ? (
              <div className="vx-actions">
                {primaryActions.map((action, index) => (
                  <button key={`p-${index}`} type="button" className="vx-btn vx-btn-primary" onClick={action.onClick}>
                    {action.label}
                  </button>
                ))}
                {otherActions.length > 0 ? (
                  <div className="vx-actions-row">
                    {otherActions.map((action, index) => (
                      <button key={`o-${index}`} type="button" className="vx-btn" onClick={action.onClick}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {caption && plain(caption) ? (
        // Not a live region: Vox is already saying these words aloud.
        <div className="vx-caption">
          <span className="vx-caption-bar" aria-hidden="true" />
          <p>{plain(caption, 800)}</p>
        </div>
      ) : null}
    </section>
  );
}
