export const approvedDesktopApps = Object.freeze({
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
  return typeof appId === "string" ? approvedDesktopApps[appId] ?? null : null;
}

export function isBlockedDesktopControlPrompt(prompt) {
  return typeof prompt !== "string" || !prompt.trim() || blockedAction.test(prompt);
}
