// The Mac app's built-in browser for the stage (see desktop/VoxDesktop/src/stage-browser.mjs).
// On the web and on phones there is none, and the stage shows a readable
// version of the page instead.

export type StageBrowserState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
} | null;

export type StageBrowserBridge = {
  open: (url: string) => Promise<boolean>;
  layout: (visible: boolean, bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
  command: (action: "back" | "forward" | "reload" | "stop" | "external") => Promise<boolean>;
  read: () => Promise<{ url: string; title: string; text: string } | null>;
  onState: (listener: (state: StageBrowserState) => void) => () => void;
};

export function stageBrowserBridge(): StageBrowserBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { voxLocalCodex?: { browser?: StageBrowserBridge } }).voxLocalCodex?.browser ?? null;
}
