import { disableNotifications } from "@/reminders/notifications";
import { cancelVoiceInput } from "./voiceInput";
import { resetSpeechPreferences } from "./speech";
import { resetVoiceConfiguration } from "./voiceConfig";

export const resetLocalPreferences = () => {
  disableNotifications();
  cancelVoiceInput();
  resetSpeechPreferences();
  resetVoiceConfiguration();
};
