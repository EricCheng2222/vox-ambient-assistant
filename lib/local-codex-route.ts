const explicitCodexRequest =
  /(?:\b(?:ask|use|let|have|send|hand|tell)\b.{0,48}\b(?:codex|coding agent|local agent)\b|\b(?:codex|coding agent|local agent)\b.{0,48}\b(?:inspect|debug|fix|repair|review|refactor|implement|edit|modify|change|test|run|build|work on)\b|(?:交給|用|叫|讓|請).{0,24}(?:codex|本機代理|程式代理)|(?:codex|本機代理|程式代理).{0,24}(?:檢查|除錯|修復|修改|實作|重構|測試|處理|建立))/iu;

const directEngineeringRequest =
  /(?:^(?:please\s+)?(?:inspect|debug|fix|repair|review|refactor|implement|edit|modify|change|test|run|build)\b|\b(?:can|could|would) you (?:inspect|debug|fix|repair|review|refactor|implement|edit|modify|change|test|run|build)\b|\bhelp me (?:inspect|debug|fix|repair|review|refactor|implement|edit|modify|change|test|run|build)\b)/iu;

const engineeringTarget =
  /\b(?:repo|repository|project|codebase|code|app|website|site|file|function|component|test|tests|build|bug|error|failing|implementation)\b|(?:專案|程式碼|代碼|網站|網頁|應用程式|檔案|函式|元件|測試|建置|錯誤|bug|實作)/iu;

const directChineseEngineeringRequest =
  /^(?:(?:請|幫我|麻煩你|可以請你|能不能)\s*)?(?:檢查|除錯|修復|修好|修改|實作|重構|跑測試|測試|建置|處理)/u;

export function isLocalCodexTask(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (explicitCodexRequest.test(value)) return true;
  return (
    engineeringTarget.test(value) &&
    (directEngineeringRequest.test(value) || directChineseEngineeringRequest.test(value))
  );
}
