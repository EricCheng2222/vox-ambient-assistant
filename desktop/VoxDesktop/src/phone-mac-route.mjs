const smartHomeDevice = /\b(?:dyson|purifier|air purifier|fan)\b|(?:Dyson|清淨機|空氣清淨機|風扇)/iu;
const smartHomeAction = /\b(?:turn|switch|power|fan speed|air quality|temperature|humidity|oscillat|auto mode)\b|(?:打開|開啟|關閉|關掉|電源|風速|空氣品質|溫度|濕度|擺頭|自動模式)/iu;
const workspaceRequest = /\b(?:open|show|reveal)\b.{0,28}\b(?:workspace|project folder|codex folder)\b|(?:打開|開啟|顯示).{0,20}(?:工作區|專案資料夾|Codex資料夾)/iu;
const launchAction = /\b(?:open|launch|start)\b|(?:打開|開啟|啟動)/iu;
const interactionBeyondLaunch = /\b(?:close|quit|click|press|tap|scroll|drag|select|choose|type|write|draft|compose|enter|fill|paste|play|pause|resume|stop|search|find|navigate|go to|switch|create|new tab|back|forward|zoom|mute|unmute|website|web page|youtube|url|file|folder|downloads)\b|(?:關閉|關掉|退出|點擊|按下|按一下|捲動|滾動|拖曳|選擇|輸入|打字|寫入|草擬|貼上|播放|暫停|繼續|停止|搜尋|尋找|前往|切換|新增|分頁|上一頁|下一頁|放大|縮小|靜音|網站|網頁|網址|檔案|文件|資料夾|下載項目)/iu;
const desktopAction = /\b(?:open|launch|start|close|quit|click|press|tap|scroll|drag|select|choose|type|write|draft|compose|enter|fill|paste|play|pause|resume|stop|search|find|navigate|go to|switch|create|new tab|back|forward|zoom|mute|unmute)\b|(?:打開|開啟|啟動|關閉|關掉|退出|點擊|按下|按一下|捲動|滾動|拖曳|選擇|輸入|打字|寫入|草擬|貼上|播放|暫停|繼續|停止|搜尋|尋找|前往|切換|新增|分頁|上一頁|下一頁|放大|縮小|靜音)/iu;

const semanticAppRules = [
  { bundleId: "com.apple.Music", pattern: /\b(?:music|song|album|playlist)\b|(?:音樂|歌曲|歌單)/iu },
  { bundleId: "com.apple.Safari", pattern: /\b(?:browser|website|web page|new tab|youtube|url)\b|(?:瀏覽器|網站|網頁|分頁|網址)/iu },
  { bundleId: "com.apple.finder", pattern: /\b(?:finder|file|folder|downloads|desktop)\b|(?:檔案|文件|資料夾|下載項目|桌面)/iu },
  { bundleId: "com.apple.mail", pattern: /\b(?:mail|email|inbox)\b|(?:郵件|電子郵件|收件匣)/iu },
  { bundleId: "com.apple.MobileSMS", pattern: /\b(?:message|imessage|text message)\b|(?:訊息|簡訊)/iu },
  { bundleId: "com.apple.iCal", pattern: /\b(?:calendar|appointment|event)\b|(?:行事曆|日曆|約會)/iu },
  { bundleId: "com.apple.reminders", pattern: /\breminders?\b|提醒事項/iu },
  { bundleId: "com.apple.Maps", pattern: /\b(?:maps?|directions?)\b|(?:地圖|導航)/iu },
  { bundleId: "com.apple.Photos", pattern: /\b(?:photos?|pictures?)\b|(?:照片|相片)/iu },
  { bundleId: "com.apple.Notes", pattern: /\bnotes?\b|備忘錄/iu },
];

export function isPhoneSmartHomeRequest(prompt) {
  return typeof prompt === "string" && smartHomeDevice.test(prompt) && smartHomeAction.test(prompt);
}

export function isPhoneWorkspaceRequest(prompt) {
  return typeof prompt === "string" && workspaceRequest.test(prompt);
}

export function isPhoneDesktopAction(prompt) {
  return typeof prompt === "string" && desktopAction.test(prompt);
}

export function phoneDesktopIntent(prompt, appOnly = false) {
  if (appOnly) return "launch";
  return launchAction.test(prompt) && !interactionBeyondLaunch.test(prompt)
    ? "launch"
    : "interact";
}

export function inferPhoneDesktopApp(prompt, apps) {
  if (typeof prompt !== "string" || !Array.isArray(apps)) return null;
  for (const rule of semanticAppRules) {
    if (!rule.pattern.test(prompt)) continue;
    const match = apps.find((candidate) => candidate.bundleId === rule.bundleId);
    if (match) return match;
  }
  return null;
}
