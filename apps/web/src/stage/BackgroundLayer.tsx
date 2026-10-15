import { useEffect, useRef, useState } from "react";
import Grainient from "@/components/Grainient";
import { GRAINIENT_PRESETS } from "@/motion/motionDirector";
import { useDisplayPreferences } from "@/state/canvasStore";

/**
 * Independent z-0 background. Never inside the React Flow transform, never
 * pointer-driven (`interactive={false}` + `clickSwirl={false}`). Mounted from
 * the start so the instance is warm by the time the wake reveal uncovers it;
 * the standby black layer sits above it. Grainient itself pauses on
 * `document.hidden`, caps dpr <= 2, and freezes animation under
 * `prefers-reduced-motion`.
 */
export const BackgroundLayer = ({ theme }: { theme: "light" | "dark" }) => {
  const preferences = useDisplayPreferences();
  const hostRef = useRef<HTMLDivElement>(null);
  const [glLost, setGlLost] = useState(false);
  const [glUnavailable] = useState(() => {
    try {
      return !document.createElement("canvas").getContext("webgl2");
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (glUnavailable) return;
    const host = hostRef.current;
    if (!host) return;
    const canvas = host.querySelector("canvas");
    if (!canvas) return;
    let attached = true;
    const onLost = (event: Event) => {
      event.preventDefault();
      // Some engines can reclaim a context synchronously while another React
      // subtree allocates graphics resources. Commit fallback after that render.
      queueMicrotask(() => { if (attached) setGlLost(true); });
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => { attached = false; canvas.removeEventListener("webglcontextlost", onLost); };
  }, [glUnavailable]);

  const preset = GRAINIENT_PRESETS[theme];

  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      data-vivic-layer="background"
    >
      {glLost || glUnavailable ? (
        // Graceful context-loss fallback: quiet flat tint instead of a crash.
        <div
          className="absolute inset-0"
          style={{
            background:
              theme === "dark"
                ? "radial-gradient(circle at 50% 40%, #221c48 0%, #0a0d1c 75%)"
                : "radial-gradient(circle at 50% 40%, #f3ecff 0%, #eef3fd 75%)",
          }}
        />
      ) : (
        <Grainient
          colors={[...preset.colors]}
          lightMode={preset.lightMode}
          speed={preferences.reducedMotion ? 0 : 0.5}
          grainAnimated={!preferences.reducedMotion}
          flow={0.55}
          scale={1}
          softness={1}
          silk={0.3}
          grainAmount={0.07}
          interactive={false}
          clickSwirl={false}
          intro={false}
          dpr={1.75}
        />
      )}
    </div>
  );
};
