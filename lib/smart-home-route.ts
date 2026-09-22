const smartHomeMatchers = [
  {
    adapter: "dyson-local",
    target: /\b(?:dyson|air purifier|purifier)\b|戴森|空氣清淨機|空气净化器|清淨機|净化器/iu,
    action: /\b(?:on|off|power|start|stop|status|speed|level|auto|automatic|night|sleep|oscillat|swing|air quality|temperature|humidity)\b|開啟|开启|打開|打开|關閉|关闭|關掉|关掉|開機|开机|關機|关机|狀態|状态|風速|风速|自動|自动|夜間|夜间|睡眠|擺動|摆动|搖頭|摇头|空氣品質|空气质量|溫度|温度|濕度|湿度/iu,
  },
] as const;

export function matchSmartHomeControlRequest(text: string) {
  const value = text.trim();
  if (!value) return null;
  const match = smartHomeMatchers.find(
    (candidate) => candidate.target.test(value) && candidate.action.test(value),
  );
  return match ? { adapter: match.adapter } : null;
}

export function isSmartHomeControlRequest(text: string) {
  return matchSmartHomeControlRequest(text) !== null;
}
