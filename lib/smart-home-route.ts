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
  deviceName = "Dyson",
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
  const permissionFailure = /local network access.*denied/iu.test(message);
  const uncertainCommand = /after the command was sent|updated state is unconfirmed/iu.test(message);
  const cloudSignIn = /sign in to Dyson again|connect your Dyson account/iu.test(message);
  const cloudFailure = /Dyson['’]s cloud|through Dyson cloud|cloud broker/u.test(message);
  const closedConnection = /closed the local control connection|rejected the MQTT protocol/iu.test(message);
  const noState = /connected, but did not answer the device state/iu.test(message);
  const connectionFailure = /could not connect|did not answer|connack|ECONNRESET|network/iu.test(message);

  if (language === "taiwan_mandarin") {
    if (macPaused) return "Mac 上的遠端控制目前暫停中。請在 Vox Desktop 的「Phone control」開啟遠端控制，再試一次。";
    if (macUnreachable) return "目前連不上配對的 Mac。請確認 Vox Desktop 正在以 Vox Cloud 模式執行，稍後再試一次。";
    if (noDevice) return "Mac 上還沒有可用的智慧家庭裝置。請先在 Vox Desktop 的「Home」連結 Dyson。";
    if (cloudSignIn) return "請在 Vox Desktop 的「Home devices」登入 Dyson，以啟用或恢復雲端控制。";
    if (uncertainCommand) return `指令已送出，但 ${deviceName} 沒有確認更新後的狀態。我不會自動重送，以免重複執行。`;
    if (cloudFailure) return `目前無法透過 Dyson 雲端確認 ${deviceName} 的狀態。請稍後再試，或在「Home devices」檢查 Dyson 連線。`;
    if (permissionFailure) return `Mac 拒絕連線到 ${deviceName}。請在 macOS「隱私權與安全性 → 本機網路」允許 Vox。`;
    if (credentialFailure) return `${deviceName} 沒有接受目前儲存的本機憑證，請在「Home devices」重新連結裝置。`;
    if (closedConnection) return `${deviceName} 可以連到，但它關閉了本機控制連線。請在「Home devices」登入 Dyson，讓 Vox 改用雲端控制。`;
    if (noState) return `${deviceName} 已連線，但沒有回覆裝置狀態。Vox 已重試；請在「Home devices」確認装置設定。`;
    if (connectionFailure) return `Vox 已重新尋找 ${deviceName} 並重試，目前仍連不上。請確認它已接上電源，且與 Mac 位於同一個網路。`;
    return `目前無法控制 ${deviceName}，請稍後再試一次。`;
  }

  if (macPaused) return "Remote control is paused on the Mac. In Vox Desktop, open Phone control and allow remote control, then try again.";
  if (macUnreachable) return "I can’t reach the paired Mac right now. Make sure Vox Desktop is running in Vox Cloud mode, then try again.";
  if (noDevice) return "The Mac has no smart-home device set up yet. Connect the Dyson from Home in Vox Desktop first.";
  if (cloudSignIn) return "Sign in to Dyson in Vox Desktop’s Home devices to enable or restore cloud control.";
  if (uncertainCommand) return `The command was sent, but ${deviceName}'s updated state is unconfirmed. I won’t automatically repeat it.`;
  if (cloudFailure) return `I couldn’t confirm ${deviceName}'s state through Dyson cloud. Try again shortly, or check its Dyson connection in Home devices.`;
  if (permissionFailure) return `This Mac denied local network access to ${deviceName}. Allow Vox in macOS Settings → Privacy & Security → Local Network.`;
  if (credentialFailure) return `${deviceName} did not accept the saved local credential. Please reconnect the device in Home devices.`;
  if (closedConnection) return `${deviceName} is reachable, but closes the local control connection. Sign in to Dyson in Home devices so Vox can use cloud control.`;
  if (noState) return `${deviceName} connected, but did not return device state after retrying. Check its saved configuration in Home devices.`;
  if (connectionFailure) return `Vox looked for ${deviceName} again and retried, but still can’t reach it. Check that it has power and shares this Mac’s local network.`;
  return `I can’t control ${deviceName} right now. Please try again shortly.`;
}
