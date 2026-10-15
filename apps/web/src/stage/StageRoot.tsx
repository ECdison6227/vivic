import { useEffect, useState } from "react";
import { CanvasView } from "@/canvas/CanvasView";
import { resolveTheme } from "@/motion/motionDirector";
import { useVivicState, useDisplayPreferences } from "@/state/canvasStore";
import { BackgroundLayer } from "./BackgroundLayer";
import { BlackVeil } from "./BlackVeil";
import { OrbLayer } from "./OrbLayer";
import { SubtitleLayer } from "./SubtitleLayer";
import { motion, useReducedMotion, MotionConfig } from "motion/react";

/**
 * Display layering (bottom → top):
 * z-0  React Bits Grainient (independent, never transformed with the canvas)
 * z-10 React Flow canvas + cards
 * z-20 standby black veil / wake reveal mask
 * z-30 SmoothUI Siri Orb
 * z-40 transient subtitle
 */
export const StageRoot = () => {
  const stage = useVivicState((s) => s.stage);
  const theme = useVivicState((s) => s.ambient.theme);
  const reminderAlert = useVivicState((s) => s.subtitle?.priority === "reminder");
  const preferences = useDisplayPreferences();
  const reduced = useReducedMotion() || preferences.reducedMotion;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (theme !== "auto") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (timer !== undefined) clearTimeout(timer);
      const current = Date.now();
      setNow(new Date(current));
      // Align to wall-clock minutes, rather than one minute after mounting.
      // Hidden windows resume immediately on visibility/pageshow restoration.
      if (!document.hidden) timer = setTimeout(update, 60_000 - current % 60_000);
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pageshow", update);
    };
  }, [theme]);
  const resolvedTheme = resolveTheme(theme, now, preferences);

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}><div
      className="fixed inset-0 overflow-hidden bg-black"
      data-vivic-stage={stage}
      data-vivic-theme={resolvedTheme}
    >
      <BackgroundLayer theme={resolvedTheme} />
      <motion.div className="pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true" data-vivic-reminder-glow={reminderAlert ? "true" : undefined}
        style={{ background: "radial-gradient(ellipse at 50% 100%, rgb(250 165 75 / 0.28), transparent 70%)" }}
        animate={{ opacity: reminderAlert ? 1 : 0 }} transition={{ duration: reduced ? 0 : 1.2 }}
      />
      {stage === "WORKSPACE" && <CanvasView resolvedTheme={resolvedTheme} />}
      <BlackVeil />
      <OrbLayer />
      <SubtitleLayer />
    </div></MotionConfig>
  );
};
