#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const shutdownTimeoutMs = Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? 25_000);
const children = new Map();
let shuttingDown = false;
let shutdownStarted = false;

function scriptPath(...parts) {
  return path.join(appRoot, ...parts);
}

function pipeWithPrefix(name, stream, output) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => output.write(`[${name}] ${line}\n`));
}

function spawnLogged(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.set(name, child);
  pipeWithPrefix(name, child.stdout, process.stdout);
  pipeWithPrefix(name, child.stderr, process.stderr);
  child.once("exit", () => children.delete(name));
  return child;
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function runStep(name, args) {
  console.log(`[startup] Running ${name}`);
  const child = spawnLogged(name, args);
  const { code, signal } = await waitForExit(child);
  if (shuttingDown) return;
  if (code !== 0) {
    throw new Error(`${name} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`);
  }
}

async function shutdown(reason, exitCode = 0) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  shuttingDown = true;
  console.log(`[startup] Received ${reason}; shutting down gracefully.`);

  const liveChildren = [...children.entries()].filter(([, child]) => child.exitCode === null && child.signalCode === null);
  for (const [name, child] of liveChildren) {
    console.log(`[startup] Sending SIGTERM to ${name}.`);
    child.kill("SIGTERM");
  }

  const timeout = setTimeout(() => {
    for (const [name, child] of children.entries()) {
      if (child.exitCode === null && child.signalCode === null) {
        console.log(`[startup] ${name} did not exit before timeout; sending SIGKILL.`);
        child.kill("SIGKILL");
      }
    }
  }, shutdownTimeoutMs);

  await Promise.all(liveChildren.map(([, child]) => waitForExit(child)));
  clearTimeout(timeout);
  console.log("[startup] Shutdown complete.");
  process.exit(exitCode);
}

function watchLongRunning(name, child) {
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `exit code ${code}`;
    console.error(`[startup] ${name} exited unexpectedly with ${detail}.`);
    void shutdown(`${name} exited unexpectedly`, code && code > 0 ? code : 1);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
process.on("SIGINT", () => void shutdown("SIGINT", 0));

async function main() {
  await runStep("migrate", [scriptPath("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"]);
  await runStep("seed", [scriptPath("node_modules", "tsx", "dist", "cli.mjs"), "prisma/seed.ts"]);

  console.log("[startup] Starting web and worker processes.");
  const web = spawnLogged("web", [scriptPath("node_modules", "next", "dist", "bin", "next"), "start"]);
  const worker = spawnLogged("worker", [scriptPath("node_modules", "tsx", "dist", "cli.mjs"), "worker/index.ts"]);
  watchLongRunning("web", web);
  watchLongRunning("worker", worker);
}

main().catch((error) => {
  if (shuttingDown) return;
  console.error(error instanceof Error ? error.message : error);
  void shutdown("startup failure", 1);
});
