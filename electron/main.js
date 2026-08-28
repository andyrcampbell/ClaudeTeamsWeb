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

const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

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

// Ask, once, where the user wants their team folders to live, and create it.
// A macOS .dmg has no installer UI to ask this in, so first run is the only
// place the question can be put to both platforms alike. The answer goes into
// the same settings.json the running app reads and writes.
async function resolveTeamsLocation(dataDir) {
  const settingsFile = path.join(dataDir, "settings.json");
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8")).location;
    if (saved && fs.existsSync(saved)) return saved;
  } catch {
    /* first run, or settings.json unreadable — ask below */
  }

  const fallback = path.join(app.getPath("home"), "MyAITeams");
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose where to keep your AI Teams",
    message: "Each team you create becomes a folder here.",
    defaultPath: app.getPath("home"),
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
  });

  const chosen = !canceled && filePaths[0] ? filePaths[0] : fallback;
  fs.mkdirSync(chosen, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ location: chosen }, null, 2));
  return chosen;
}

function startServer(teamsLocation) {
  process.env.ACS_DATA_DIR = app.getPath("userData");
  // Prompts are seeded here from the bundle on first run, so they stay
  // editable and survive app updates instead of living inside app.asar.
  process.env.ACS_PROMPTS_DIR = path.join(app.getPath("userData"), "Prompts");
  process.env.ACS_DEFAULT_LOCATION = teamsLocation;
  process.env.PORT = String(PORT);
  // Where the bundled interviewee photo pool lives, for server.js to seed from.
  if (app.isPackaged) process.env.ACS_RESOURCES_DIR = process.resourcesPath;
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
  const teamsLocation = await resolveTeamsLocation(app.getPath("userData"));
  startServer(teamsLocation);
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
