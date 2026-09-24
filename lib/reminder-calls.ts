import { reminderCallScript } from "@/lib/reminder";
import {
  claimDueCallReminders,
  markDueCallRemindersUnavailable,
  recordReminderCall,
} from "@/lib/reminder-store";
import {
  getPhoneAssistantDestination,
  PHONE_ASSISTANT_OWNER_ID,
} from "@/lib/phone-assistant-store";
import { getTwilioConfig, placeTwilioCall } from "@/lib/twilio";

export type ReminderCallDispatch = {
  placed: number;
  failed: number;
  unavailable: number;
};

// Phone-call delivery is an owner-only telephone capability, so only the
// owner's reminders are ever dialled, and only to the owner's own callback
// number while "calls from Vox" is switched on.
export async function dispatchDueReminderCalls(now = new Date()): Promise<ReminderCallDispatch> {
  const result = { placed: 0, failed: 0, unavailable: 0 };
  const ownerId = PHONE_ASSISTANT_OWNER_ID;
  const destination = getTwilioConfig()
    ? await getPhoneAssistantDestination(ownerId)
    : null;
  if (!destination) {
    result.unavailable = (await markDueCallRemindersUnavailable(ownerId, now)).length;
    return result;
  }

  for (const reminder of await claimDueCallReminders(ownerId, now)) {
    const script = reminderCallScript(reminder);
    try {
      await placeTwilioCall(destination, script.text, {
        language: script.language,
        repeat: true,
      });
      await recordReminderCall(reminder.id, true);
      result.placed += 1;
    } catch (error) {
      console.error("Reminder call failed", error);
      await recordReminderCall(reminder.id, false);
      result.failed += 1;
    }
  }
  return result;
}
