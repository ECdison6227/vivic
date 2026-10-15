// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BackgroundLayer } from "../BackgroundLayer";
vi.mock("@/components/Grainient", () => ({ default: () => <canvas /> }));
vi.mock("@/state/canvasStore", () => ({ useDisplayPreferences: () => ({ reducedMotion: true }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
it("handles driver loss during another render without React updates or allocating a probe context", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const Label = () => { host.querySelector("canvas")?.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); return <span>TEST</span>; };
  const Scene = ({ trigger }: { trigger: boolean }) => <><BackgroundLayer theme="dark" />{trigger && <Label />}</>;
  await act(async () => root.render(<Scene trigger={false} />));
  await act(async () => root.render(<Scene trigger={true} />));
  expect(getContext).not.toHaveBeenCalled();
  expect(host.querySelector("canvas")?.style.visibility).toBe("hidden");
  expect(host.querySelector('[data-vivic-gl-lost="true"]')).not.toBeNull();
  expect(errors.mock.calls.flat().join(" ")).not.toContain("Cannot update");
  await act(async () => root.unmount());
});
