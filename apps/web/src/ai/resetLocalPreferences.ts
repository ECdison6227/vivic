import { cancelVoiceInput } from "./voiceInput";
import { resetSpeechPreferences } from "./speech";
import { resetVoiceConfiguration } from "./voiceConfig";

export const resetLocalPreferences = () => {
  cancelVoiceInput();
  resetSpeechPreferences();
  resetVoiceConfiguration();
};
