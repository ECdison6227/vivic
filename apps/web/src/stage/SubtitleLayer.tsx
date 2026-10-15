import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { canvasStore, useVivicState, useDisplayPreferences } from "@/state/canvasStore";

/**
 * Bottom-centre transient voice text. No bubble, no avatar, no timestamp.
 * Consecutive `subtitle.show` events replace the current line; the line
 * self-dismisses after durationMs.
 */
export const SubtitleLayer = () => {
  const preferences = useDisplayPreferences();
  const subtitle = useVivicState((s) => s.subtitle);
  const activity = useVivicState((s) => s.activity);
  const line = activity?.phase === "speaking" ? activity : subtitle?.priority === "reminder" ? subtitle : activity ?? subtitle;
  const showingActivity = Boolean(activity && line === activity);
  const lineId = line && ("requestId" in line ? line.requestId : line.id);

  useEffect(() => {
    if (!activity) return;
    const timer = setTimeout(() => {
      if (canvasStore.getState().activity?.requestId === activity.requestId) {
        canvasStore.internal({ type: "activity.set", activity: null });
      }
    }, Math.max(0, activity.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [activity]);

  useEffect(() => {
    if (!subtitle) return;
    const timer = setTimeout(
      () => canvasStore.internal({ type: "subtitle.dismiss", id: subtitle.id }),
      subtitle.durationMs,
    );
    return () => clearTimeout(timer);
  }, [subtitle]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[7vh] z-40 flex justify-center px-8"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {preferences.subtitles && line && (
          <motion.p
            key={lineId}
            data-vivic-subtitle={lineId}
            data-vivic-reminder-alert={!showingActivity && subtitle?.priority === "reminder" ? "true" : undefined}
            data-vivic-thinking={showingActivity && activity?.phase !== "speaking" ? "true" : undefined}
            data-vivic-speaking={showingActivity && activity?.phase === "speaking" ? "true" : undefined}
            className="vivic-subtitle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            {line.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
};
