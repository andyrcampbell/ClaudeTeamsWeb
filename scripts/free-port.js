// Free the app's port so the server can (re)start cleanly -- but only if the
// process holding it is one of ours. This used to force-kill whoever was
// listening, which meant launching the app would take out an unrelated dev
// server that happened to be on the same port. Now we ask the listener who it
// is (GET /api/ping, served by server.js) and leave strangers alone.
//
// The probe follows the socket rather than assuming loopback: an instance
// started by start-tailscale.cmd binds ONLY to the Tailscale IP, so asking
// 127.0.0.1 got connection-refused and mislabelled our own server a stranger
// -- which then blocked the app from starting at all. We now read the bound
// addresses out of netstat/lsof and ask each one in turn.
//
// Async, and awaited by every caller, because the identity probe is a real HTTP
// request: electron/main.js must not start its own server until this settles.
// Used by `npm run restart`, `npm run stop`, the launcher scripts and
// electron/main.js.
const { execSync } = require("child_process");
const http = require("http");

const APP_ID = "acs-ai-teams"; // what /api/ping reports; see server.js
const PROBE_TIMEOUT_MS = 1500;

// Every socket listening on `port`, as { pid, addr } -- addr being the local
// address it is bound to ("0.0.0.0", "100.x.y.z", "::1", ...).
function listeningSockets(port) {
  const found = new Map(); // `${pid}|${addr}` -> entry, deduped
  const add = (pid, addr) => {
    if (!/^\d+$/.test(pid)) return;
    found.set(`${pid}|${addr}`, { pid, addr });
  };
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p tcp", { stdio: ["ignore", "pipe", "ignore"] }).toString();
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        // Proto  Local Address  Foreign Address  State  PID
        if (parts.length < 5 || parts[0].toUpperCase() !== "TCP") continue;
        const local = /^(.*):(\d+)$/.exec(parts[1]);
        if (!local || local[2] !== String(port)) continue;
        // "LISTENING" is localized on non-English Windows, so also accept the
        // shape of a listening row: a foreign address of <anything>:0.
        if (!/LISTEN/i.test(parts[3]) && !/:0$/.test(parts[2])) continue;
        add(parts[4], local[1]);
      }
    } else {
      const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -Fpn || true`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      let pid = "";
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith("p")) pid = line.slice(1);
        else if (line.startsWith("n")) {
          const local = /^(.*):(\d+)$/.exec(line.slice(1));
          if (local && local[2] === String(port)) add(pid, local[1]);
        }
      }
    }
  } catch {
    /* no netstat/lsof, or nothing listening -- treat as free */
  }
  return [...found.values()];
}

// Addresses worth asking, loopback first (the common case, and the cheapest
// answer). A wildcard bind is reachable on loopback; a specific bind is only
// reachable at that address.
function probeHosts(sockets) {
  const hosts = ["127.0.0.1"];
  for (const { addr } of sockets) {
    let host = addr.replace(/^\[/, "").replace(/\]$/, "");
    if (!host || host === "*" || host === "0.0.0.0") host = "127.0.0.1";
    else if (host === "::" || host === "::0") host = "::1";
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

// Ask whoever holds the port to identify itself. Resolves to the /api/ping
// payload if it's this app, or null for anything else (including no answer at
// all, a non-HTTP listener, or a timeout) -- null means "don't touch it".
function identify(host, port) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/api/ping", timeout: PROBE_TIMEOUT_MS }, (res) => {
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
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

async function identifyAny(hosts, port) {
  for (const host of hosts) {
    const info = await identify(host, port);
    if (info) return { info, host };
  }
  return null;
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
  const sockets = listeningSockets(port);
  if (sockets.length === 0) {
    console.log(`  port ${port} already free`);
    return true;
  }

  const pids = [...new Set(sockets.map((s) => s.pid))];
  const found = await identifyAny(probeHosts(sockets), port);
  if (!found) {
    console.warn(
      `  port ${port} is held by PID ${pids.join(", ")}, which is not ACS AI Teams -- leaving it alone.\n` +
        `  Stop that program, or set the PORT environment variable to start on a different port.`
    );
    return false;
  }

  if (found.host !== "127.0.0.1") {
    console.log(`  found a running ACS AI Teams on ${found.host}:${port}`);
  }
  // Prefer the pid the app reported: it names the process actually serving,
  // so we don't take out a sibling that merely shares the listening socket.
  const targets = pids.includes(String(found.info.pid)) ? [String(found.info.pid)] : pids;
  for (const pid of targets) killPid(port, pid);
  return true;
}

module.exports = freePort;

// Still runnable directly (`node scripts/free-port.js`) for the launcher
// scripts and the npm stop/restart scripts.
if (require.main === module) freePort();
