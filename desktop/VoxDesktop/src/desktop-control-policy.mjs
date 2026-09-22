export const approvedDesktopApps = Object.freeze({
  music: { name: "Apple Music", bundleId: "com.apple.Music" },
  podcasts: { name: "Podcasts", bundleId: "com.apple.podcasts" },
  tv: { name: "Apple TV", bundleId: "com.apple.TV" },
  photos: { name: "Photos", bundleId: "com.apple.Photos" },
  calendar: { name: "Calendar", bundleId: "com.apple.iCal" },
  reminders: { name: "Reminders", bundleId: "com.apple.reminders" },
  maps: { name: "Maps", bundleId: "com.apple.Maps" },
  weather: { name: "Weather", bundleId: "com.apple.weather" },
  clock: { name: "Clock", bundleId: "com.apple.clock" },
  contacts: { name: "Contacts", bundleId: "com.apple.AddressBook" },
  quicktime: { name: "QuickTime Player", bundleId: "com.apple.QuickTimePlayerX" },
  mail: { name: "Mail", bundleId: "com.apple.mail" },
  messages: { name: "Messages", bundleId: "com.apple.MobileSMS" },
  finder: { name: "Finder", bundleId: "com.apple.finder" },
  safari: { name: "Safari", bundleId: "com.apple.Safari" },
  chrome: { name: "Google Chrome", bundleId: "com.google.Chrome" },
  preview: { name: "Preview", bundleId: "com.apple.Preview" },
  notes: { name: "Notes", bundleId: "com.apple.Notes" },
  calculator: { name: "Calculator", bundleId: "com.apple.calculator" },
  textedit: { name: "TextEdit", bundleId: "com.apple.TextEdit" },
  vscode: { name: "Visual Studio Code", bundleId: "com.microsoft.VSCode" },
});

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

export function approvedDesktopApp(appId) {
  return typeof appId === "string" && Object.hasOwn(approvedDesktopApps, appId) ? approvedDesktopApps[appId] : null;
}

export function isDraftOnlyDesktopControlPrompt(prompt) {
  if (typeof prompt !== "string") return false;
  const value = prompt.trim();
  if (!value || directTransmitControl.test(value)) return false;
  if (contextualDraftRequest.test(value)) return true;
  if (!communicationComposer.test(value)) return false;
  return draftVerb.test(value) || transmitAction.test(value) || naturalComposeRequest.test(value);
}

export function isBlockedDesktopControlPrompt(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) return true;
  return alwaysBlockedAction.test(prompt) ||
    (transmitAction.test(prompt) && !isDraftOnlyDesktopControlPrompt(prompt));
}

export function isClosingDesktopApp(prompt) {
  return typeof prompt === "string" && /\b(?:close|quit|exit)\b|關閉|关闭|關掉|关掉|退出/iu.test(prompt);
}

export function currentDesktopActionText(prompt) {
  if (typeof prompt !== "string") return "";
  const marker = "Current user request:";
  const markerAt = prompt.lastIndexOf(marker);
  return markerAt >= 0 ? prompt.slice(markerAt + marker.length).trim() : prompt.trim();
}

export function hasRunningDesktopApp(output) {
  return typeof output === "string" && /\bASN:/u.test(output);
}
