import { ControlApp } from "@/control/ControlApp";
import { DisplayApp } from "@/display/DisplayApp";

/**
 * One app, two pages (pathname routing, no router dependency):
 *   /            -> /control (redirect)
 *   /display     -> read-only stage; ?canvasId= pins a canvas
 *   /control     -> input, canvas manager, data actions (sole writer)
 *   (unknown)    -> /control
 */
const rawPath = window.location.pathname.replace(/\/+$/, "") || "/";
const isDisplay = rawPath === "/display";

if (rawPath !== "/display" && rawPath !== "/control") {
  window.location.replace(`/control${window.location.search}`);
}

function App() {
  return isDisplay ? <DisplayApp /> : <ControlApp />;
}

export default App;
