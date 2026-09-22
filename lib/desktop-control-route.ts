export type ApprovedDesktopAppId =
  | "finder"
  | "safari"
  | "chrome"
  | "preview"
  | "notes"
  | "calculator"
  | "textedit"
  | "vscode";

export type DesktopControlIntent = "launch" | "interact";

export type DesktopControlRequest = {
  appId: ApprovedDesktopAppId;
  appName: string;
  intent: DesktopControlIntent;
};

const approvedApps: Array<{
  id: ApprovedDesktopAppId;
  name: string;
  pattern: RegExp;
}> = [
  { id: "finder", name: "Finder", pattern: /\bfinder\b|(?:訪達|Finder)/iu },
  { id: "safari", name: "Safari", pattern: /\bsafari\b/iu },
  {
    id: "chrome",
    name: "Google Chrome",
    pattern: /\b(?:google )?chrome\b|(?:谷歌|Google)瀏覽器/iu,
  },
  { id: "preview", name: "Preview", pattern: /\bpreview\b|預覽程式/iu },
  { id: "notes", name: "Notes", pattern: /\b(?:apple )?notes\b|備忘錄/iu },
  {
    id: "calculator",
    name: "Calculator",
    pattern: /\bcalculator\b|計算機/iu,
  },
  {
    id: "textedit",
    name: "TextEdit",
    pattern: /\btext\s*edit\b|文字編輯/iu,
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    pattern: /\b(?:visual studio code|vs\s*code|vscode)\b/iu,
  },
];

const launchAction =
  /\b(?:open|launch|start|show|focus|switch to|bring up)\b|(?:打開|開啟|啟動|顯示|切換到|叫出)/iu;

const interactionAction =
  /\b(?:click|double[- ]?click|tap|press|scroll|select|choose|navigate|type|enter|search|look at|read|control|use|new tab|open (?:a )?tab|create (?:a )?tab|switch tabs?|close (?:the )?tab)\b|(?:點擊|按下|按一下|雙擊|捲動|滾動|選擇|輸入|搜尋|瀏覽|操作|使用|幫我看|讀取|新增分頁|開新分頁|切換分頁|關閉分頁)/iu;

const blockedAction =
  /\b(?:delete|remove|trash|empty trash|send|message|email|post|publish|share|upload|buy|pay|purchase|checkout|log ?in|sign ?in|password|passcode|credential|api key|secret|install|uninstall|download|change (?:a |the )?(?:setting|preference)|system settings|terminal|shell command)\b|(?:刪除|移除|丟到垃圾桶|清空垃圾桶|傳送|寄出|寄信|發文|發布|分享|上傳|購買|付款|結帳|登入|密碼|憑證|金鑰|安裝|解除安裝|下載|更改設定|系統設定|終端機|指令)/iu;

export function containsBlockedDesktopAction(text: string) {
  return blockedAction.test(text.trim());
}

const mediaAction = /\b(?:pause|resume|play|mute|unmute|rewind|fast[- ]?forward)\b|暫停|繼續播放|播放|靜音|取消靜音|快轉|倒轉/iu;

export function detectApprovedDesktopApp(text: string) {
  const value = text.trim();
  if (!value) return null;
  const app = approvedApps.find((candidate) => candidate.pattern.test(value));
  return app ? { id: app.id, name: app.name } : null;
}

export function classifyDesktopControlRequest(
  text: string,
  previous?: DesktopControlRequest | null,
): DesktopControlRequest | null {
  const value = text.trim();
  if (!value || containsBlockedDesktopAction(value)) return null;
  const app = detectApprovedDesktopApp(value) ?? (previous ? { id: previous.appId, name: previous.appName } : null);
  if (!app) return null;

  const wantsInteraction = interactionAction.test(value) || mediaAction.test(value);
  const wantsLaunch = launchAction.test(value);
  if (!wantsInteraction && !wantsLaunch) return null;

  return {
    appId: app.id,
    appName: app.name,
    intent: wantsInteraction || (!detectApprovedDesktopApp(value) && previous) ? "interact" : "launch",
  };
}

// Routine interactions in any allowlisted app skip Vox's extra confirmation.
// Native platform permissions and the desktop policy still apply.
export function isRoutineDesktopAction(text: string, control: DesktopControlRequest, inferred = false) {
  return approvedApps.some((app) => app.id === control.appId) &&
    !containsBlockedDesktopAction(text) &&
    !/\b(?:submit|confirm|accept|agree|allow|enable|disable|subscribe|unsubscribe)\b|提交|確認|同意|允許|啟用|停用|訂閱/iu.test(text) &&
    (inferred || launchAction.test(text) || interactionAction.test(text) || mediaAction.test(text));
}

export function isDesktopControlRequest(text: string) {
  return classifyDesktopControlRequest(text) !== null;
}

export function inferredDesktopControl(text: string, appId: unknown, confidence: unknown): DesktopControlRequest | null {
  if (containsBlockedDesktopAction(text) || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0.8) return null;
  const app = approvedApps.find((candidate) => candidate.id === appId);
  if (!app) return null;
  const explicit = detectApprovedDesktopApp(text);
  if (explicit && explicit.id !== app.id) return null;
  return { appId: app.id, appName: app.name, intent: "interact" };
}
