// Free the app's port so the server can (re)start cleanly -- but only if the
// process holding it is one of ours. This used to force-kill whoever was
// listening, which meant launching the app would take out an unrelated dev
// server that happened to be on the same port. Now we ask the listener who it
// is (GET /api/ping, served by server.js) and leave strangers alone.
//
// Async, and awaited by every caller, because the identity probe is a real HTTP
// request: electron/main.js must not start its own server until this settles.
// Used by `npm run restart`, `npm run stop`, the launcher scripts and
// electron/main.js.
const { execSync } = require("child_process");
const http = require("http");

const APP_ID = "acs-ai-teams"; // what /api/ping reports; see server.js
const PROBE_TIMEOUT_MS = 1500;

function listeningPids(port) {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p tcp", { stdio: ["ignore", "pipe", "ignore"] }).toString();
      for (const line of out.split(/\r?\n/)) {
        if (line.includes(`:${port} `) && /LISTENING/.test(line)) {
          const pid = line.trim().split(/\s+/).pop();
          if (/^\d+$/.test(pid)) pids.add(pid);
        }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} || true`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
      for (const pid of out.trim().split(/\s+/)) if (/^\d+$/.test(pid)) pids.add(pid);
    }
  } catch {
    /* no netstat/lsof, or nothing listening -- treat as free */
  }
  return [...pids];
}

// Ask whoever holds the port to identify itself. Resolves to the /api/ping
// payload if it's this app, or null for anything else (including no answer at
// all, a non-HTTP listener, or a timeout) -- null means "don't touch it".
function identify(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/ping", timeout: PROBE_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096) req.destroy(); // not our tiny JSON; give up
        });
        res.on("end", () => {
          try {
            const info = JSON.parse(body);
            resolve(info && info.app === APP_ID ? info : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function killPid(port, pid) {
  try {
    if (process.platform === "win32") execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
    else execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    console.log(`  freed port ${port} (stopped PID ${pid})`);
  } catch {
    /* already gone */
  }
}

async function freePort(port = process.env.PORT || 41730) {
  const pids = listeningPids(port);
  if (pids.length === 0) {
    console.log(`  port ${port} already free`);
    return true;
  }

  const info = await identify(port);
  if (!info) {
    console.warn(
      `  port ${port} is held by PID ${pids.join(", ")}, which is not ACS AI Teams -- leaving it alone.\n` +
        `  Stop that program, or set the PORT environment variable to start on a different port.`
    );
    return false;
  }

  // Prefer the pid the app reported: it names the process actually serving,
  // so we don't take out a sibling that merely shares the listening socket.
  const targets = pids.includes(String(info.pid)) ? [String(info.pid)] : pids;
  for (const pid of targets) killPid(port, pid);
  return true;
}

module.exports = freePort;

// Still runnable directly (`node scripts/free-port.js`) for the launcher
// scripts and the npm stop/restart scripts.
if (require.main === module) freePort();
