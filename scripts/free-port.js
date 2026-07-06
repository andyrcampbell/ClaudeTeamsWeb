// Kill whatever is listening on the app's port so the server can (re)start
// cleanly. Cross-platform; used by `npm run restart` and the launcher scripts.
const { execSync } = require("child_process");
const port = process.env.PORT || 4173;

function killPid(pid) {
  try {
    if (process.platform === "win32") execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
    else execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    console.log(`  freed port ${port} (stopped PID ${pid})`);
  } catch {
    /* already gone */
  }
}

try {
  const pids = new Set();
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
  if (pids.size === 0) console.log(`  port ${port} already free`);
  for (const pid of pids) killPid(pid);
} catch {
  console.log(`  port ${port} already free`);
}
