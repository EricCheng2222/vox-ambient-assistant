export type VoiceConfirmation = "confirm" | "cancel" | "unknown";

const workspaceTarget =
  /\b(?:folder|workspace|project (?:folder|directory)|codex folder|selected folder|chosen folder)\b|(?:資料夾|工作區|專案目錄|專案資料夾|選(?:擇|好)的資料夾)/iu;

const openAction =
  /\b(?:open|show|reveal|bring up)\b|(?:打開|開啟|顯示|帶我到|開給我看)/iu;

export function isOpenWorkspaceRequest(text: string) {
  const value = text.trim();
  return Boolean(value && workspaceTarget.test(value) && openAction.test(value));
}

export function classifyVoiceConfirmation(text: string): VoiceConfirmation {
  const value = text.trim().toLocaleLowerCase();
  if (!value) return "unknown";

  if (
    /\b(?:no|nope|cancel|stop|never mind|nevermind|do not|don't|dont)\b|(?:不要|不用|取消|算了|先不要|別開|不要開)/iu.test(
      value,
    )
  ) {
    return "cancel";
  }

  if (
    /\b(?:yes|yeah|yep|sure|okay|ok|go ahead|please do|do it|open it|show it)\b|(?:好|好的|可以|沒問題|對|是|請開|打開吧|開吧|開啟吧)/iu.test(
      value,
    )
  ) {
    return "confirm";
  }

  return "unknown";
}

export function isStandaloneVoiceConfirmation(text: string) {
  const value = text
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s.,!?，。！？、]+/gu, "");
  return /^(?:yes|yeah|yep|sure|okay|ok|goahead|pleasedo|doit|好|好的|可以|沒問題|没问题|對|对|是|是的)$/iu.test(value);
}
