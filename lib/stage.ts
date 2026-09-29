// The stage: what Vox puts on screen while it explains something — the
// sources it used and the facts it pulled out of them. Filled by web answers
// (from /api/reason) and by the live model's show_on_stage tool.

export type StageSource = {
  url: string;
  title: string;
  /** Hostname without "www.", for labels. */
  site: string;
  image?: string | null;
  /** A short passage from the page, plain text. */
  excerpt?: string | null;
};

export type StageBlock =
  | { kind: "facts"; title: string; rows: Array<{ label: string; value: string }> }
  | { kind: "table"; title: string; columns: string[]; rows: string[][] }
  | { kind: "steps"; title: string; items: string[] }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "quote"; text: string; source?: string };

export type StageContent = {
  id: string;
  /** The question or topic, shown as the stage's heading. */
  title: string;
  sources: StageSource[];
  blocks: StageBlock[];
  createdAt: number;
};

/** A readable version of one web page, from /api/stage/page. */
export type StagePage = {
  url: string;
  site: string;
  title: string;
  description: string | null;
  image: string | null;
  /** Main text as paragraphs, plain text, at most ~40 paragraphs. */
  paragraphs: string[];
};
