import { isStandaloneVoiceConfirmation } from "./desktop-action-route.ts";

export type ApprovedDesktopAppId =
  | `installed:${string}`
  | "music"
  | "podcasts"
  | "tv"
  | "photos"
  | "calendar"
  | "reminders"
  | "maps"
  | "weather"
  | "clock"
  | "contacts"
  | "quicktime"
  | "mail"
  | "messages"
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
  { id: "music", name: "Apple Music", pattern: /\b(?:apple )?music\b|音樂/iu },
  { id: "podcasts", name: "Podcasts", pattern: /\bpodcasts?\b/iu },
  { id: "tv", name: "Apple TV", pattern: /\bapple tv\b/iu },
  { id: "photos", name: "Photos", pattern: /\bphotos\b|照片/iu },
  { id: "calendar", name: "Calendar", pattern: /\bcalendar\b|行事曆/iu },
  { id: "reminders", name: "Reminders", pattern: /\breminders\b|提醒事項/iu },
  { id: "maps", name: "Maps", pattern: /\b(?:apple )?maps\b|地圖/iu },
  { id: "weather", name: "Weather", pattern: /\bweather app\b|天氣程式/iu },
  { id: "clock", name: "Clock", pattern: /\bclock\b|時鐘/iu },
  { id: "contacts", name: "Contacts", pattern: /\bcontacts\b|聯絡人/iu },
  { id: "quicktime", name: "QuickTime Player", pattern: /\bquicktime(?: player)?\b/iu },
  { id: "mail", name: "Mail", pattern: /\b(?:apple )?mail\b|郵件/iu },
  { id: "messages", name: "Messages", pattern: /\bmessages\b|訊息程式/iu },
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
  /\b(?:open|launch|start|show|focus|switch to|bring up)\b|(?:打開|打开|開啟|开启|啟動|启动|顯示|显示|切換到|切换到|叫出)/iu;

const closeAction = /\b(?:close|quit|exit)\b|關閉|关闭|關掉|关掉|退出/iu;
const implicitDesktopTarget = /\b(?:youtube|google|web ?site|web ?page|page|video|tab|window|folder|file|pdf)\b|(?:這個|这个|那個|那个|這裡|这里|那裡|那里|第[一二三四五六七八九十\d]+個|第[一二三四五六七八九十\d]+个|下一個|下一个|上一個|上一个)/iu;

const interactionAction =
  /\b(?:click|double[- ]?click|tap|press|scroll|select|choose|navigate|type|write|draft|compose|enter|fill in|paste|search|look at|read|control|use|new tab|open (?:a )?tab|create (?:a )?tab|switch tabs?|close (?:the )?tab)\b|(?:點擊|按下|按一下|雙擊|捲動|滾動|選擇|輸入|寫(?:下|入)?|草擬|填入|貼上|打(?!開|开)|搜尋|瀏覽|操作|使用|幫我看|讀取|新增分頁|開新分頁|切換分頁|關閉分頁)/iu;

const alwaysBlockedAction =
  /\b(?:delete|remove|trash|empty trash|buy|pay|purchase|checkout|log ?in|sign ?in|password|passcode|credential|api key|secret|install|uninstall|download|change (?:a |the )?(?:setting|preference)|system settings|terminal|shell command)\b|(?:刪除|移除|丟到垃圾桶|清空垃圾桶|購買|付款|結帳|登入|密碼|憑證|金鑰|安裝|解除安裝|下載|更改設定|系統設定|終端機|指令)/iu;

const transmitAction =
  /\b(?:send|submit|email|post|publish|share|upload)\b|\bmessage\s+(?:him|her|them|this person|that person|the contact)\b|(?:傳送|送出|發送|寄出|寄信|發訊息|傳訊息|發消息|傳消息|發文|發布|分享|上傳)/iu;

const draftVerb =
  /\b(?:type|write|draft|compose|enter|fill in|paste)\b|(?:輸入|寫(?:下|入)?|草擬|填入|貼上|打(?!開|开))/iu;

const communicationComposer =
  /\b(?:line|messages?|mail|email|reply|chat|dm|composer|text field|message field|slack|teams|discord|whatsapp|instagram|messenger)\b|(?:LINE|訊息|消息|郵件|回覆|聊天|私訊|對話框|輸入框)/iu;

const contextualDraftRequest =
  /^(?:好[，, ]*)?(?:可以|能|可不可以|麻煩|請|幫我|你幫我)*[，, ]*(?:打(?!開|开)|輸入|寫下)(?:一下|這段|这段)?(?:好嗎|好吗|可以嗎|可以吗)?[？?。.!！ ]*$/iu;

const naturalComposeRequest =
  /\b(?:tell|reply to|write to)\s+(?:him|her|them|this person|that person)\b|(?:跟|告訴|告诉).{0,24}(?:這個人|这个人|那個人|那个人|他|她|對方|对方).{0,24}(?:說|说)|(?:在|用)\s*LINE.{0,24}(?:說|说|回覆|回复)/iu;

const directTransmitControl =
  /\b(?:click|press|tap|select|choose)\s+(?:the\s+)?(?:send|submit|post|publish|share|upload)(?:\s+button)?\b|(?:點擊|按下|按一下|選擇|选择).{0,12}(?:傳送|送出|發送|寄出|發文|發布|分享|上傳)/iu;

export function isDraftOnlyDesktopAction(text: string) {
  const value = text.trim();
  if (!value || directTransmitControl.test(value)) return false;
  if (contextualDraftRequest.test(value)) return true;
  if (!communicationComposer.test(value)) return false;
  return draftVerb.test(value) || transmitAction.test(value) || naturalComposeRequest.test(value);
}

export function containsBlockedDesktopAction(text: string) {
  const value = text.trim();
  return alwaysBlockedAction.test(value) ||
    (transmitAction.test(value) && !isDraftOnlyDesktopAction(value));
}

const mediaAction = /\b(?:pause|resume|play|mute|unmute|rewind|fast[- ]?forward)\b|暫停|繼續播放|播放|靜音|取消靜音|快轉|倒轉/iu;

export function detectApprovedDesktopApp(text: string) {
  const value = text.trim();
  if (!value) return null;
  const app = approvedApps.find((candidate) => candidate.pattern.test(value));
  return app ? { id: app.id, name: app.name } : null;
}

export function hasDesktopControlEvidence(text: string) {
  const value = text.trim();
  return Boolean(
    value &&
    !isStandaloneVoiceConfirmation(value) &&
    (
      launchAction.test(value) ||
      interactionAction.test(value) ||
      mediaAction.test(value) ||
      closeAction.test(value) ||
      detectApprovedDesktopApp(value) ||
      implicitDesktopTarget.test(value) ||
      isDraftOnlyDesktopAction(value)
    )
  );
}

export function classifyDesktopControlRequest(
  text: string,
  previous?: DesktopControlRequest | null,
  installedApp?: { id: ApprovedDesktopAppId; name: string } | null,
): DesktopControlRequest | null {
  const value = text.trim();
  if (!value || containsBlockedDesktopAction(value)) return null;
  const app = installedApp ?? detectApprovedDesktopApp(value) ?? (previous ? { id: previous.appId, name: previous.appName } : null);
  if (!app) return null;

  const wantsInteraction = interactionAction.test(value) || mediaAction.test(value) ||
    closeAction.test(value) || isDraftOnlyDesktopAction(value);
  const wantsLaunch = launchAction.test(value);
  if (!wantsInteraction && !wantsLaunch) return null;

  return {
    appId: app.id,
    appName: app.name,
    intent: wantsInteraction || (!installedApp && !detectApprovedDesktopApp(value) && previous) ? "interact" : "launch",
  };
}

// Routine interactions in any allowlisted app skip Vox's extra confirmation.
// Native platform permissions and the desktop policy still apply.
export function isRoutineDesktopAction(text: string, control: DesktopControlRequest, inferred = false) {
  return (approvedApps.some((app) => app.id === control.appId) || /^installed:[\w.-]+$/.test(control.appId)) &&
    !containsBlockedDesktopAction(text) &&
    !/\b(?:submit|confirm|accept|agree|allow|enable|disable|subscribe|unsubscribe)\b|提交|確認|同意|允許|啟用|停用|訂閱/iu.test(text) &&
    (inferred || launchAction.test(text) || interactionAction.test(text) || mediaAction.test(text) || closeAction.test(text) || isDraftOnlyDesktopAction(text));
}

export function isDesktopControlRequest(text: string) {
  return classifyDesktopControlRequest(text) !== null;
}

export function inferredDesktopControl(text: string, appId: unknown, confidence: unknown): DesktopControlRequest | null {
  if (!hasDesktopControlEvidence(text) || containsBlockedDesktopAction(text) || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0.8) return null;
  const app = approvedApps.find((candidate) => candidate.id === appId);
  if (!app) return null;
  const explicit = detectApprovedDesktopApp(text);
  if (explicit && explicit.id !== app.id) return null;
  return { appId: app.id, appName: app.name, intent: "interact" };
}
