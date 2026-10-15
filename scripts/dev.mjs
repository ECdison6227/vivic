#!/usr/bin/env node
/**
 * One-command dev: web (:5173) + local decision API (127.0.0.1:8787).
 * Zero-dependency concurrent runner: pipes prefixed output, forwards signals,
 * and tears the group down if either side exits.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";

const tasks = [
  { name: "web", args: ["--filter", "@vivic/web", "dev"] },
  { name: "api", args: ["--filter", "@vivic/local-api", "dev"] },
];

const children = tasks.map(({ name, args }) => {
  const child = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    readline
      .createInterface({ input: stream })
      .on("line", (line) => console.log(`[${name}] ${line}`));
  }
  child.on("exit", (code) => shutdown(code ?? 0, name));
  return child;
});

let shuttingDown = false;
function shutdown(code, reason = "signal") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dev] ${reason} ended; stopping all…`);
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}

process.on("SIGINT", () => shutdown(0, "SIGINT"));
process.on("SIGTERM", () => shutdown(0, "SIGTERM"));
