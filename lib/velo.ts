// VÉLO in a Vox conversation: the user's training, food and habit notebook,
// a Worker in the Vox family (the velo/ submodule, reached over MCP; see
// lib/mcp-client.ts). Vox adds to it whenever the user reports something and
// reads it when they ask; replacing the plan or deleting an item waits for a
// spoken yes.

/** Run only after the user says yes. */
export const VELO_CONFIRMED_TOOLS = ["set_plan", "delete_item"] as const;

/** Reads, entries that only add to the notebook, and undoing the last one. */
export const VELO_UNCONFIRMED_TOOLS = [
  "log_workout",
  "log_set",
  "log_meal",
  "log_entry",
  "get_today",
  "get_timeline",
  "get_exercise",
  "get_trends",
  "get_profile",
  "set_profile",
  "get_plan",
  "undo_last",
] as const;

export const VELO_VOICE_INSTRUCTIONS = [
  "The user keeps a notebook of their body and habits in VÉLO, and you keep it for them with the VÉLO tools. When they tell you they did or measured something, log it right away, without asking: exercise (log_set for the quick case, such as \"I did 50 push-ups\" or \"bench three sets of eight at 60 kilos\"; log_workout for a whole session at once), a meal or snack (log_meal, with your best estimate of protein, carbs and fat in grams; say it's an estimate), and anything else with log_entry: water, body weight, sleep, medication or supplements, how they feel, or a habit such as study minutes.",
  "Then confirm in a few words using the running total the tool returns (\"Logged. That's 150 today.\"). Reuse the exercise names and units the notebook already has. Don't log plans, wishes, things other people did, or the same statement twice. If they say it was wrong, use undo_last and log the right one.",
  "Read it when they ask how they're doing: get_today for today, get_exercise for one exercise's totals and streak (\"how many push-ups this week?\"), get_trends for progress, get_timeline for what happened when, get_plan for their training plan. set_profile changes their time zone, kg or lb, and daily targets when they ask.",
  "set_plan (it archives the current plan) and delete_item wait for the user's yes; the app asks, so don't ask for confirmation yourself.",
].join(" ");
