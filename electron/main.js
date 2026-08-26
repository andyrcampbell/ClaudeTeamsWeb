// Electron shell for ACS AI Teams. Runs the existing server.js (unchanged
// Express/ws/node-pty backend) directly in-process under Electron's own
// bundled Node, then shows the existing web UI in a BrowserWindow pointed at
// that local server. No target-machine Node.js install is required.
//
// (Earlier versions spawned server.js as a separate child process via
// ELECTRON_RUN_AS_NODE. In the packaged app that child unreliably lost the
// env vars carrying the writable per-user data dir, so server.js fell back
// to a path inside the read-only app.asar and crashed on startup. Requiring
// it in-process sidesteps that entirely.)

const { app, BrowserWindow } = require("electron");
const path = require("path");
const http = require("http");

const PORT = process.env.PORT || 4173;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const SERVER_PATH = path.join(__dirname, "..", "server.js");
const FREE_PORT_SCRIPT = path.join(__dirname, "..", "scripts", "free-port.js");
const ICON_PATH = path.join(__dirname, "..", "build", "icon.ico");

let mainWindow = null;

function freePort() {
  // Mirrors start.cmd/start.sh: kill whatever's already listening on our
  // port before starting, so a relaunch doesn't collide with a leftover run.
  try {
    require(FREE_PORT_SCRIPT);
  } catch (err) {
    console.warn("free-port step failed (continuing):", err.message);
  }
}

function startServer() {
  process.env.ACS_DATA_DIR = app.getPath("userData");
  process.env.ACS_DEFAULT_LOCATION = path.join(app.getPath("home"), "MyAITeams");
  process.env.PORT = String(PORT);
  require(SERVER_PATH);
}

function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      const req = http.get(SERVER_URL, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Timed out waiting for the local server to start."));
        } else {
          setTimeout(poll, 300);
        }
      });
    })();
  });
}

async function createWindow() {
  await waitForServer();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "ACS AI Teams",
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(SERVER_URL);
}

app.whenReady().then(async () => {
  freePort();
  startServer();
  try {
    await createWindow();
  } catch (err) {
    console.error(err.message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

// server.js runs in this same process and already handles SIGINT/SIGTERM
// (flush scrollback, persist sessions) — self-signal on quit to reuse that
// shutdown path rather than duplicating it here.
app.on("before-quit", () => {
  process.kill(process.pid, "SIGTERM");
});
