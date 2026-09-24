const smartHomeMatchers = [
  {
    adapter: "dyson-local",
    target: /\b(?:dyson|air purifier|purifier)\b|戴森|空氣清淨機|空气净化器|清淨機|净化器/iu,
    action: /\b(?:on|off|power|start|stop|status|speed|level|auto|automatic|night|sleep|oscillat|swing|air quality|temperature|humidity)\b|開啟|开启|打開|打开|關閉|关闭|關掉|关掉|開機|开机|關機|关机|狀態|状态|風速|风速|自動|自动|夜間|夜间|睡眠|擺動|摆动|搖頭|摇头|空氣品質|空气质量|溫度|温度|濕度|湿度/iu,
  },
] as const;

const competingFollowUpTarget = /\b(?:music|video|screen|display|computer|mac|phone|camera|app)\b|音樂|音乐|影片|螢幕|屏幕|電腦|电脑|手機|手机|相機|相机|程式|应用/iu;
const outdoorFollowUpTarget = /\b(?:weather|outside|outdoor)\b|天氣|天气|戶外|户外|室外|外面/iu;
const deviceSpecificFollowUp = /\b(?:air quality|temperature|humidity|fan speed|auto mode|night mode|oscillat|swing)\b|空氣品質|空气质量|溫度|温度|濕度|湿度|風速|风速|自動模式|自动模式|夜間模式|夜间模式|睡眠模式|擺動|摆动|搖頭|摇头/iu;
const referentialFollowUp = /^(?:and\s+)?(?:what about|then|it|that|again)\b|^(?:那|那麼|那么|然後|然后|它|再)/iu;
const retryFollowUp = /^(?:please\s+)?(?:try|do)(?:\s+it)?\s+again[.!?\s]*$|^(?:好|好的|OK|okay|嗯|呃|麻煩|请|請|可以|那)?[，,\s]*(?:再|重新)(?:幫我|帮我)?(?:試|试)(?:一)?次(?:看看)?[。.!?\s]*$/iu;
const implicitFanSpeedControl = /(?:\b(?:set|change|adjust)\b|幫我|帮我|請|请|調(?:成|到)?|调(?:成|到)?).*(?:\b(?:fan\s*)?speed\b|風速|风速)|(?:\b(?:fan\s*)?speed\b|風速|风速).*(?:\b(?:to|at)\b|調|调|設|设|[0-9一二兩两三四五六七八九十])/iu;

export function matchSmartHomeControlRequest(text: string) {
  const value = text.trim();
  if (!value) return null;
  const match = smartHomeMatchers.find(
    (candidate) => candidate.target.test(value) && candidate.action.test(value),
  );
  if (match) return { adapter: match.adapter };
  if (
    !competingFollowUpTarget.test(value) &&
    !outdoorFollowUpTarget.test(value) &&
    implicitFanSpeedControl.test(value)
  ) {
    return { adapter: "dyson-local" as const };
  }
  return null;
}

export function isSmartHomeControlRequest(text: string) {
  return matchSmartHomeControlRequest(text) !== null;
}

export function isSmartHomeFollowUpRequest(text: string) {
  const value = text.trim();
  if (!value || competingFollowUpTarget.test(value) || outdoorFollowUpTarget.test(value)) return false;
  const action = smartHomeMatchers.some((candidate) => candidate.action.test(value));
  return action && (deviceSpecificFollowUp.test(value) || referentialFollowUp.test(value));
}

export function isSmartHomeRetryRequest(text: string) {
  return retryFollowUp.test(text.trim());
}

export function smartHomeFailureMessage(
  rawMessage: string,
  language: "taiwan_mandarin" | "english",
) {
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/iu, "")
    .trim();
  // Paired-Mac relay failures come first: they are not Dyson problems, and
  // "did not answer" also appears in the relay's expiry message.
  const macPaused = /remote control is paused/iu.test(message);
  const macUnreachable = /paired Mac is offline|Mac did not (?:accept|answer)|command expired/iu.test(message);
  const noDevice = /configured smart-home device/iu.test(message);
  const credentialFailure = /rejected its local device credential|not authorized|bad (?:user|password)/iu.test(message);
  const connectionFailure = /could not connect|did not answer|connack|ECONNRESET|network/iu.test(message);

  if (language === "taiwan_mandarin") {
    if (macPaused) return "Mac 上的遠端控制目前暫停中。請在 Vox Desktop 的「Phone control」選擇允許直到 Vox 結束，再試一次。";
    if (macUnreachable) return "目前連不上配對的 Mac。請確認 Vox Desktop 正在以 Vox Cloud 模式執行，稍後再試一次。";
    if (noDevice) return "Mac 上還沒有可用的智慧家庭裝置。請先在 Vox Desktop 的「Home」連結 Dyson。";
    if (credentialFailure) return "Dyson 沒有接受目前儲存的本機憑證，請重新連結裝置。";
    if (connectionFailure) return "目前連不上 Dyson。請確認它已開機並連上同一個 Wi-Fi；如果剛設定完成，可以重新開機後再試一次。";
    return "目前無法控制 Dyson，請稍後再試一次。";
  }

  if (macPaused) return "Remote control is paused on the Mac. In Vox Desktop, open Phone control and allow it until Vox quits, then try again.";
  if (macUnreachable) return "I can’t reach the paired Mac right now. Make sure Vox Desktop is running in Vox Cloud mode, then try again.";
  if (noDevice) return "The Mac has no smart-home device set up yet. Connect the Dyson from Home in Vox Desktop first.";
  if (credentialFailure) return "Dyson did not accept the saved local credential. Please reconnect the device.";
  if (connectionFailure) return "I can’t reach Dyson right now. Make sure it is powered on and connected to the same Wi-Fi; if it was just configured, restart it and try again.";
  return "I can’t control Dyson right now. Please try again shortly.";
}
