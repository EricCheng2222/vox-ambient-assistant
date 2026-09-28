"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Mic, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { WelcomeHomeDesktopSection } from "@/components/welcome-home";
import {
  filterMicrophone,
  voiceFilterBridge,
  type FilteredMicrophone,
  type VoiceFilterStatus,
  type VoiceFilterStrictness,
} from "@/lib/desktop-voice-filter";

// Read aloud during setup: a mix of English and Mandarin, since the owner
// talks to Vox in both.
const SETUP_SENTENCES = [
  "Good morning, Vox. Let's go through my flash cards on genetics and biochemistry.",
  "今天下午有什麼行程？提醒我離開家的時候要帶衣服。",
  "Could you check the weather and then quiz me on the harder cards?",
  "我們先複習生物化學，再考我幾張遺傳學的卡片。",
];
const MIN_SETUP_SECONDS = 14;

const STRICTNESS: Array<{ value: VoiceFilterStrictness; label: string; hint: string }> = [
  { value: "relaxed", label: "Relaxed", hint: "Rarely misses you; lets similar voices through more often" },
  { value: "normal", label: "Normal", hint: "Balanced" },
  { value: "strict", label: "Strict", hint: "Blocks more; may need a moment to recognize you" },
];

/**
 * Settings for the Vox desktop app's voice filter (Mac only): removing
 * background noise and music, and optionally only listening to the owner.
 */
export function VoiceFilterSettings() {
  const [bridge] = useState(() => voiceFilterBridge());
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<VoiceFilterStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const recordingRef = useRef<{ raw: MediaStream; filtered: FilteredMicrophone; timer: number } | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    setStatus(await bridge.status().catch(() => null));
  }, [bridge]);

  const stopRecording = useCallback(() => {
    const active = recordingRef.current;
    if (!active) return;
    window.clearInterval(active.timer);
    active.filtered.stop();
    active.raw.getTracks().forEach((track) => track.stop());
    recordingRef.current = null;
    setRecording(false);
    setLevel(0);
  }, []);

  useEffect(() => {
    if (open) queueMicrotask(() => void refresh());
  }, [open, refresh]);

  useEffect(() => () => stopRecording(), [stopRecording]);

  if (!bridge) return null;

  async function change(changes: Parameters<NonNullable<typeof bridge>["update"]>[0]) {
    if (!bridge) return;
    setBusy(true);
    try {
      setStatus(await bridge.update(changes));
    } catch (error) {
      toast.error("Couldn’t change the voice filter", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function startSetup() {
    try {
      const raw = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
      const filtered = await filterMicrophone(raw, "enroll");
      filtered.onLevel(setLevel);
      const started = Date.now();
      const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
      recordingRef.current = { raw, filtered, timer };
      setElapsed(0);
      setRecording(true);
    } catch (error) {
      toast.error("Couldn’t use the microphone", { description: error instanceof Error ? error.message : undefined });
    }
  }

  async function finishSetup() {
    if (!bridge) return;
    setBusy(true);
    try {
      const result = await bridge.finishEnrollment();
      stopRecording();
      setStatus(result);
      toast.success("Vox learned your voice", {
        description:
          result.consistency < 0.75
            ? "The recording was a bit uneven. If Vox misses you, record again somewhere quiet."
            : "Only your voice will reach Vox from now on.",
      });
    } catch (error) {
      toast.error("Voice setup didn’t finish", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function cancelSetup() {
    stopRecording();
    await bridge?.cancelEnrollment().catch(() => undefined);
  }

  async function forget() {
    if (!bridge) return;
    setBusy(true);
    try {
      setStatus(await bridge.forget());
      toast.success("Deleted your voiceprint from this Mac");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && recording) void cancelSetup();
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 rounded-full border-white/10 bg-white/[0.04] px-3 text-white/66 shadow-none hover:bg-white/10 hover:text-white"
          aria-label="Open voice filter settings"
        >
          <AudioLines />
          <span className="hidden sm:inline">Voice</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(94vw,460px)] border-white/10 bg-[#10111b] text-white sm:max-w-[460px]">
        <SheetHeader className="border-b border-white/8 px-6 py-6 pr-12">
          <div className="flex items-center gap-2 text-[#f4ff74]">
            <AudioLines size={18} />
            <SheetTitle className="font-display text-xl text-white">Voice filter</SheetTitle>
          </div>
          <SheetDescription className="mt-2 leading-6 text-white/46">
            Cleans up your microphone before Vox hears it, so music and background sound
            don’t get mistaken for you.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="flex items-start gap-2 rounded-xl border border-emerald-300/12 bg-emerald-300/[0.045] px-3.5 py-3 text-xs leading-5 text-white/56">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
            Everything runs on this Mac. Your voiceprint is encrypted with macOS secure
            storage and never leaves this computer.
          </div>

          {status === null ? (
            <p className="text-sm text-white/40">Loading…</p>
          ) : !status.available ? (
            <p className="text-sm leading-6 text-white/56">
              The voice filter isn’t installed in this copy of Vox. Update the desktop app to use it.
            </p>
          ) : (
            <>
              <label className="flex items-start justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3.5">
                <span>
                  <span className="block text-sm font-medium text-white">Remove background noise and music</span>
                  <span className="mt-1 block text-xs leading-5 text-white/46">
                    Filters out music, fans, and room noise. Adds almost no delay.
                  </span>
                </span>
                <Switch
                  checked={status.denoise}
                  disabled={busy}
                  onCheckedChange={(checked) => void change({ denoise: checked })}
                  aria-label="Remove background noise and music"
                />
              </label>

              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3.5">
                <div className="flex items-start justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium text-white">Only listen to my voice</span>
                    <span className="mt-1 block text-xs leading-5 text-white/46">
                      Optional. Ignores other people, TV, and singers in music. Adds about a
                      second before Vox hears you.
                    </span>
                  </span>
                  <Switch
                    checked={status.onlyMyVoice}
                    disabled={busy || !status.enrolled}
                    onCheckedChange={(checked) => void change({ onlyMyVoice: checked })}
                    aria-label="Only listen to my voice"
                  />
                </div>

                {!status.enrolled && !recording && (
                  <Button
                    type="button"
                    className="mt-3 w-full rounded-full bg-[#f4ff74] text-[#10111b] hover:bg-[#ebf969]"
                    disabled={busy || !status.secureStorageAvailable}
                    onClick={() => void startSetup()}
                  >
                    <Mic /> Set up my voice
                  </Button>
                )}

                {recording && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs leading-5 text-white/56">
                      Read these aloud at your normal voice, from where you usually talk to Vox:
                    </p>
                    <ol className="space-y-2 text-sm leading-6 text-white/82">
                      {SETUP_SENTENCES.map((sentence) => (
                        <li key={sentence} className="rounded-lg bg-white/[0.04] px-3 py-2">{sentence}</li>
                      ))}
                    </ol>
                    <div className="flex items-center gap-3">
                      <Mic className="size-4 text-[#f4ff74]" aria-hidden="true" />
                      <Progress value={Math.round(level * 100)} className="h-1.5" aria-label="Microphone level" />
                      <span className="w-10 text-right text-xs tabular-nums text-white/46">{elapsed}s</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 rounded-full border-white/12 bg-transparent text-white hover:bg-white/10"
                        onClick={() => void cancelSetup()}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="flex-1 rounded-full bg-[#f4ff74] text-[#10111b] hover:bg-[#ebf969]"
                        onClick={() => void finishSetup()}
                        disabled={busy || elapsed < MIN_SETUP_SECONDS}
                      >
                        {busy ? <Loader2 className="animate-spin" /> : null}
                        {elapsed < MIN_SETUP_SECONDS ? `Keep reading (${MIN_SETUP_SECONDS - elapsed}s)` : "Done"}
                      </Button>
                    </div>
                  </div>
                )}

                {status.enrolled && !recording && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="How strict">
                      {STRICTNESS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={status.strictness === option.value}
                          title={option.hint}
                          disabled={busy}
                          onClick={() => void change({ strictness: option.value })}
                          className={`rounded-lg px-2 py-2 text-xs transition ${
                            status.strictness === option.value
                              ? "bg-[#f4ff74] font-semibold text-[#10111b]"
                              : "bg-white/[0.05] text-white/60 hover:bg-white/10"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs leading-5 text-white/40">
                      {STRICTNESS.find((option) => option.value === status.strictness)?.hint}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 rounded-full border-white/12 bg-transparent text-white hover:bg-white/10"
                        disabled={busy}
                        onClick={() => void startSetup()}
                      >
                        <Mic /> Record again
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-full text-white/50 hover:text-[#ff9d96]"
                        disabled={busy}
                        onClick={() => void forget()}
                      >
                        <Trash2 /> Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <WelcomeHomeDesktopSection />

              {status.error && <p className="text-xs leading-5 text-[#ff9d96]">{status.error}</p>}
              <p className="text-xs leading-5 text-white/36">
                Changes apply right away, including to a conversation in progress.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
