import { useEffect, useRef } from "react";
import Grainient from "@/components/Grainient";
import { GRAINIENT_PRESETS } from "@/motion/motionDirector";
import { useDisplayPreferences } from "@/state/canvasStore";

/** Real Grainient stays outside the React Flow transform. Its existing quiet
 * tint also covers WebGL unavailability/loss without a React state callback
 * from the graphics driver (Firefox may dispatch that during another render). */
export const BackgroundLayer = ({ theme }: { theme: "light" | "dark" }) => {
  const preferences = useDisplayPreferences();
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current, canvas = host?.querySelector("canvas");
    if (!host || !canvas) return;
    const onLost = (event: Event) => {
      event.preventDefault();
      canvas.style.visibility = "hidden";
      host.dataset.vivicGlLost = "true";
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, []);
  const preset = GRAINIENT_PRESETS[theme];
  return <div ref={hostRef} className="pointer-events-none absolute inset-0" aria-hidden="true" data-vivic-layer="background"
    style={{ background: theme === "dark"
      ? "radial-gradient(circle at 50% 40%, #221c48 0%, #0a0d1c 75%)"
      : "radial-gradient(circle at 50% 40%, #f3ecff 0%, #eef3fd 75%)" }}>
    <Grainient colors={[...preset.colors]} lightMode={preset.lightMode} speed={preferences.reducedMotion ? 0 : 0.5}
      grainAnimated={!preferences.reducedMotion} flow={0.55} scale={1} softness={1} silk={0.3} grainAmount={0.07}
      interactive={false} clickSwirl={false} intro={false} dpr={1.75} />
  </div>;
};
