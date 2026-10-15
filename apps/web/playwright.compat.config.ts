import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Deliberately separate from the normal Chromium regression command. This
// checks actual Firefox/WebKit engines; WebKit is not a claim of Safari QA.
export default defineConfig({
  ...base,
  projects: [
    { name: "firefox", use: { browserName: "firefox", launchOptions: { args: [], firefoxUserPrefs: { "media.volume_scale": "0.0" } } } },
    { name: "webkit", use: { browserName: "webkit", launchOptions: { args: [] } } },
  ],
});
