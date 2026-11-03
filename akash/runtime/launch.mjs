import { spawn } from "node:child_process";
import { mkdir, chown, chmod } from "node:fs/promises";

if (process.getuid?.() === 0) {
  await mkdir("/data/memories", { recursive: true, mode: 0o700 });
  await chown("/data/memories", 1000, 1000);
  await chmod("/data/memories", 0o700);
  process.setgid(1000);
  process.setuid(1000);
}

const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 5000);
  timeout.unref();
  if (!children.size) process.exit(code);
}
function run(args, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit", env: process.env });
  children.add(child);
  child.on("error", () => { console.error("[runtime] child startup failed"); stop(1); });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code || 1);
    else if (!children.size) process.exit(code || 0);
  });
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
if (process.env.SOULBOUND_SERVICE === "worker") {
  run(["dist/index.js", "start"], `${process.cwd()}/agent`);
} else {
  if (!process.env.DEMO_ACCESS_USER || (process.env.DEMO_ACCESS_PASSWORD?.length ?? 0) < 24) {
    throw new Error("Operator access must be configured before serving the demo");
  }
  run(["agent/dist/life-server.js"]);
  if (process.env.SOULBOUND_RUN_WORKER === "true") run(["dist/index.js", "start"], `${process.cwd()}/agent`);
  run(["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"], `${process.cwd()}/app`);
}
