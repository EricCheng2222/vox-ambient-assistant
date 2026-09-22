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

const blockedAction =
  /\b(?:delete|remove|trash|empty trash|send|message|email|post|publish|share|upload|buy|pay|purchase|checkout|log ?in|sign ?in|password|passcode|credential|api key|secret|install|uninstall|download|change (?:a |the )?(?:setting|preference)|system settings|terminal|shell command)\b|(?:刪除|移除|丟到垃圾桶|清空垃圾桶|傳送|寄出|寄信|發文|發布|分享|上傳|購買|付款|結帳|登入|密碼|憑證|金鑰|安裝|解除安裝|下載|更改設定|系統設定|終端機|指令)/iu;

export function approvedDesktopApp(appId) {
  return typeof appId === "string" && Object.hasOwn(approvedDesktopApps, appId) ? approvedDesktopApps[appId] : null;
}

export function isBlockedDesktopControlPrompt(prompt) {
  return typeof prompt !== "string" || !prompt.trim() || blockedAction.test(prompt);
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
