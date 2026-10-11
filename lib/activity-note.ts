// A few words on what Vox is doing right now, shown while the user waits:
// "Opening airbnb.com", "Pressing 登入", "Searching your email". Built by the
// app from the step it is about to take, never from page or email content
// beyond a button's own label.

function clip(value: string, max: number) {
  const text = value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/gu, " ").replace(/\s+/gu, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function hostOf(url: unknown) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

type Context = {
  zh: boolean;
  /** The page is in the browser on the user's paired Mac. */
  onMac: boolean;
  /** The label of the page element a browser action is aimed at, when known. */
  elementLabel?: string;
};

/** What one of Vox's own tools is about to do. "" when there is nothing worth saying. */
export function toolActivity(name: string, rawArguments: string | undefined, context: Context) {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArguments ?? "{}") as Record<string, unknown>;
  } catch {
    // Described without its details.
  }
  const t = (en: string, tw: string) => (context.zh ? tw : en);
  const where = context.onMac ? t(" on your Mac", "（在你的 Mac 上）") : "";
  const label = clip(context.elementLabel ?? "", 28);
  switch (name) {
    case "show_on_stage": {
      const sources = Array.isArray(args.sources) ? (args.sources as Array<{ url?: unknown }>) : [];
      const host = hostOf(sources[0]?.url ?? args.url);
      return host ? t(`Opening ${host}${where}`, `正在打開 ${host}${where}`) : t("Putting it on screen", "正在顯示到畫面上");
    }
    case "browser_look":
      return t(`Reading the page${where}`, `正在看頁面內容${where}`);
    case "read_stage_page":
      return t("Reading the page", "正在讀這個頁面");
    case "browser_act": {
      const action = String(args.action ?? "");
      if (action === "click") return label ? t(`Pressing “${label}”${where}`, `正在按「${label}」${where}`) : t(`Pressing a button${where}`, `正在按按鈕${where}`);
      if (action === "type") return label ? t(`Typing into “${label}”${where}`, `正在輸入「${label}」${where}`) : t(`Typing${where}`, `正在輸入${where}`);
      if (action === "select") return label ? t(`Choosing in “${label}”${where}`, `正在選擇「${label}」${where}`) : t(`Choosing an option${where}`, `正在選擇選項${where}`);
      if (action === "press_enter") return t(`Submitting${where}`, `正在送出${where}`);
      return t(`Scrolling the page${where}`, `正在捲動頁面${where}`);
    }
    case "ask_user_to_fill":
      return t("Bringing up the private box", "正在叫出私密輸入框");
    case "fill_code_from_email":
      return t("Getting the code from your email", "正在從你的信箱取驗證碼");
    case "find_my_devices":
      return t("Finding your devices", "正在找你的裝置");
    case "plan_trip":
      return t("Working out the route", "正在規劃路線");
    case "create_panel":
      return t("Adding a panel", "正在新增面板");
    case "remove_panel":
      return t("Removing a panel", "正在移除面板");
    case "watch_page":
      return t("Setting up a page to watch", "正在設定要留意的頁面");
    case "read_watched_page":
      return t("Checking a watched page", "正在查看留意中的頁面");
    default:
      return "";
  }
}

const MCP_EN: Record<string, string> = {
  search_email: "Searching your email",
  unread_summary: "Checking your unread email",
  read_email: "Reading an email",
  read_thread: "Reading an email thread",
  list_accounts: "Checking your email accounts",
  list_labels: "Checking your email folders",
  create_draft: "Writing a draft",
  send_email: "Sending the email",
  reply_email: "Sending the reply",
  forward_email: "Forwarding the email",
  send_draft: "Sending the draft",
  modify_email: "Updating the email",
  trash_email: "Moving the email to the bin",
  list_events: "Looking at your calendar",
  create_event: "Adding it to your calendar",
  update_event: "Updating the event",
  invite_to_event: "Sending the invitation",
  respond_to_event: "Answering the invitation",
  delete_event: "Removing the event",
  list_tasks: "Looking at your to-dos",
  create_task: "Adding a to-do",
  update_task: "Updating the to-do",
  delete_task: "Removing the to-do",
  search_contacts: "Looking up a contact",
  create_contact: "Saving a contact",
  search_drive: "Searching your Drive",
  read_drive_file: "Reading a file from Drive",
  create_drive_file: "Saving a file to Drive",
  trash_drive_file: "Moving a file to the bin",
  next_card: "Getting your next card",
  grade_card: "Recording your answer",
  grade_cards: "Recording your answers",
  skip_card: "Skipping the card",
  study_stats: "Checking your study progress",
  list_decks: "Looking at your decks",
  list_cards: "Looking through your cards",
  add_cards: "Adding cards",
};
const MCP_ZH: Record<string, string> = {
  search_email: "正在搜尋你的信箱",
  unread_summary: "正在看未讀信件",
  read_email: "正在讀一封信",
  read_thread: "正在讀一串信件",
  create_draft: "正在寫草稿",
  send_email: "正在寄出信件",
  reply_email: "正在回信",
  forward_email: "正在轉寄信件",
  send_draft: "正在寄出草稿",
  list_events: "正在看你的行事曆",
  create_event: "正在加到行事曆",
  update_event: "正在更新行程",
  respond_to_event: "正在回覆邀請",
  list_tasks: "正在看你的待辦",
  create_task: "正在新增待辦",
  update_task: "正在更新待辦",
  search_contacts: "正在查聯絡人",
  search_drive: "正在搜尋雲端硬碟",
  read_drive_file: "正在讀雲端硬碟的檔案",
  next_card: "正在拿下一張字卡",
  grade_card: "正在記錄你的答案",
};
const SERVER_EN: Record<string, string> = { email: "Working in your email", velo: "Writing in your notebook", flashcards: "Working with your flash cards" };
const SERVER_ZH: Record<string, string> = { email: "正在處理你的信件", velo: "正在寫進你的紀錄本", flashcards: "正在處理你的字卡" };

/** What a connected service's tool (email, calendar, notebook, flash cards) is doing. */
export function serviceActivity(toolName: string | undefined, serverLabel: string | undefined, zh: boolean) {
  const name = toolName ?? "";
  const server = serverLabel ?? "";
  if (zh) return MCP_ZH[name] ?? SERVER_ZH[server] ?? MCP_EN[name] ?? SERVER_EN[server] ?? "";
  return MCP_EN[name] ?? SERVER_EN[server] ?? "";
}

/** What Vox is doing for a request it sent to another model or service, by route. */
export function routeActivity(route: string, zh: boolean) {
  const t = (en: string, tw: string) => (zh ? tw : en);
  switch (route) {
    case "live_web":
      return t("Searching the web and reading what it finds", "正在搜尋網路並閱讀結果");
    case "expert_reasoning":
      return t("Thinking it through with the stronger model", "正在用較強的模型仔細思考");
    case "balanced_reasoning":
      return t("Working out an answer", "正在整理答案");
    case "create_file":
      return t("Writing your file", "正在寫你的檔案");
    case "create_reminder":
      return t("Setting your reminder", "正在設定提醒");
    case "local_codex":
      return t("Working in your workspace on the Mac", "正在 Mac 的工作區處理");
    case "desktop_control":
    case "desktop_action":
      return t("Working on your Mac", "正在操作你的 Mac");
    default:
      return "";
  }
}
