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

const { app, BrowserWindow, dialog, Menu, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { verifyLicenseKey, loadStoredLicense, saveLicense, loadTrialState, startTrial } = require("./license");

// Keep in step with server.js's own default (see the note there on why
// this is not 4173).
const PORT = process.env.PORT || 41730;
// Bind address, matching server.js's own contract (see networkUrl below).
// The window and the readiness poll have to use whatever the server actually
// binds to: with HOST set to e.g. a Tailscale IP, nothing is listening on
// 127.0.0.1, so hardcoding loopback here would leave the app staring at a
// connection-refused page.
const HOST = process.env.HOST || "127.0.0.1";
const LOCAL_HOST = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
const SERVER_URL = `http://${LOCAL_HOST}:${PORT}`;
const SERVER_PATH = path.join(__dirname, "..", "server.js");
const FREE_PORT_SCRIPT = path.join(__dirname, "..", "scripts", "free-port.js");
const ICON_PATH = path.join(__dirname, "..", "build", "icon.ico");
// Keep in sync with the buy link hardcoded in license-gate.html.
const BUY_URL = "https://buy.stripe.com/5kQ4gsg8UdRu3Tt6gi1VK00";

let mainWindow = null;
// Where the window actually points. Normally SERVER_URL (the server we start
// ourselves), but it moves to whatever address an already-running instance
// answered on when we attach to one -- see the port check in whenReady.
let serverUrl = SERVER_URL;
// Whether server.js is running inside this process. False when we attached to
// someone else's, which the shutdown path at the bottom has to know.
let ownServerStarted = false;

// Electron shows no context menu by default, so right-clicking a text field
// (like the prompt textarea, or the license-key box) offered no Cut/Copy/
// Paste. Add one for editable fields and plain text selections, for every
// window/webContents the app creates (main window and the license gate).
app.on("web-contents-created", (_event, contents) => {
  contents.on("context-menu", (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll }
      );
    } else if (params.selectionText) {
      items.push({ role: "copy" });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
});

// Opens the activate/trial window in the given mode ("first" | "expired" |
// "reactivate") and resolves true once the user unlocks the app (activates
// a key or starts a trial) from it, or false if they just close it.
function openGateWindow(dataDir, mode) {
  return new Promise((resolve) => {
    const gateWindow = new BrowserWindow({
      width: 440,
      height: 420,
      resizable: false,
      title: "Activate ACS AI Teams",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "license-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    gateWindow.loadFile(path.join(__dirname, "license-gate.html"), { query: { mode } });

    let unlocked = false;

    ipcMain.handle("license:activate", (_event, key) => {
      const result = verifyLicenseKey(key);
      if (!result.valid) return { ok: false, error: result.reason };
      saveLicense(dataDir, key);
      unlocked = true;
      gateWindow.close();
      return { ok: true };
    });

    ipcMain.handle("license:start-trial", () => {
      startTrial(dataDir);
      unlocked = true;
      gateWindow.close();
      return { ok: true };
    });

    gateWindow.on("closed", () => {
      ipcMain.removeHandler("license:activate");
      ipcMain.removeHandler("license:start-trial");
      resolve(unlocked);
    });
  });
}

// Blocks until the app is unlocked — a valid license, or an active trial —
// showing the activate/trial window if it isn't yet. Resolves { ok: false }
// (caller should quit) if the user closes that window without unlocking.
async function ensureLicensed(dataDir) {
  if (loadStoredLicense(dataDir)) return { ok: true };

  const trial = loadTrialState(dataDir);
  if (trial && !trial.expired) return { ok: true, trialDaysLeft: trial.daysLeft };

  const unlocked = await openGateWindow(dataDir, trial && trial.expired ? "expired" : "first");
  if (!unlocked) return { ok: false };

  if (loadStoredLicense(dataDir)) return { ok: true };
  const newTrial = loadTrialState(dataDir);
  if (newTrial && !newTrial.expired) return { ok: true, trialDaysLeft: newTrial.daysLeft };
  return { ok: false };
}

// Lets a user who's mid-trial (or done with it) paste in a real license key
// without quitting the app — invoked from the "I have a key" link in the
// trial badge. Clears the badge on success.
function reactivateFromBanner(dataDir) {
  openGateWindow(dataDir, "reactivate").then((unlocked) => {
    if (unlocked && mainWindow) {
      mainWindow.webContents
        .executeJavaScript(
          "(function(){var b=document.getElementById('__acsTrialBadge');if(b)b.remove();})();"
        )
        .catch(() => {});
    }
  });
}

// Who already holds our port? Unlike start.cmd/start.sh, the app kills
// nothing -- it only looks, and adapts:
//   "free"     -- nobody there; start our own server, the ordinary case.
//   "ours"     -- a live ACS AI Teams is already serving on this machine (say,
//                 one launched by start-tailscale.cmd that a phone is using).
//                 Attach to it. This used to force-kill it, which silently
//                 dropped that phone the moment the desktop app was opened.
//   "stranger" -- someone else's program; leave it be and say so.
async function portHolder() {
  try {
    const { findInstance } = require(FREE_PORT_SCRIPT);
    return await findInstance(PORT);
  } catch (err) {
    console.warn("port check failed (continuing):", err.message);
    return { state: "free" }; // couldn't check; let the server try and report for itself
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

// HOST / ALLOWED_ORIGINS: same contract server.js uses when run directly
// (see start-tailscale.cmd for the dev flow, start-tailscale-app.cmd/.sh for
// the packaged app) -- whatever the launching process set is left as-is and
// simply flows through to server.js below, so the packaged app can be made
// reachable from another device (e.g. a phone over Tailscale) the same way
// the dev server can. Unset -> server.js's own default of 127.0.0.1
// (loopback only), so a plain double-click launch is unaffected.
function networkUrl() {
  if (HOST === "127.0.0.1" || HOST === "0.0.0.0") return null;
  return SERVER_URL;
}

function startServer(teamsLocation) {
  process.env.ACS_DATA_DIR = app.getPath("userData");
  // Prompts are seeded here from the bundle on first run, so they stay
  // editable and survive app updates instead of living inside app.asar.
  process.env.ACS_PROMPTS_DIR = path.join(app.getPath("userData"), "Prompts");
  process.env.ACS_DEFAULT_LOCATION = teamsLocation;
  process.env.PORT = String(PORT);
  // server.js only accepts requests whose Origin is on its allow-list, which
  // covers loopback by default. Once HOST moves the UI onto another address,
  // this window's own origin has to be on that list too or the app rejects
  // itself. The launcher scripts already set ALLOWED_ORIGINS; this makes a
  // bare `HOST=<ip> "ACS AI Teams.exe"` launch behave the same way.
  if (networkUrl()) {
    const origins = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (!origins.includes(SERVER_URL)) origins.push(SERVER_URL);
    process.env.ALLOWED_ORIGINS = origins.join(",");
  }
  // Where the bundled interviewee photo pool lives, for server.js to seed from.
  if (app.isPackaged) process.env.ACS_RESOURCES_DIR = process.resourcesPath;
  require(SERVER_PATH);
  ownServerStarted = true;
}

function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      const req = http.get(serverUrl, (res) => {
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

// Small floating badge (doesn't reflow the app's own layout) showing the
// trial countdown, with links back into the gate window. The links use a
// made-up "acs-license:" scheme purely so will-navigate can recognize and
// intercept the click — nothing actually navigates there.
function injectTrialBadge(daysLeft) {
  if (!mainWindow) return;
  const label = daysLeft <= 0 ? "Trial ends today" : `Trial — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  const html = `<span>${label}</span> <a href="acs-license:buy">Buy a license</a> &middot; <a href="acs-license:activate">I have a key</a>`;
  mainWindow.webContents
    .insertCSS(`
      #__acsTrialBadge {
        position: fixed; bottom: 14px; right: 14px; z-index: 2147483647;
        background: rgba(30,34,42,0.92); color: #fff;
        font: 12px -apple-system, "Segoe UI", sans-serif;
        padding: 8px 12px; border-radius: 8px;
        display: flex; align-items: center; gap: 10px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      }
      #__acsTrialBadge a { color: #8ab4ff; text-decoration: none; }
      #__acsTrialBadge a:hover { text-decoration: underline; }
    `)
    .catch(() => {});
  mainWindow.webContents
    .executeJavaScript(`
      (function() {
        if (document.getElementById('__acsTrialBadge')) return;
        var bar = document.createElement('div');
        bar.id = '__acsTrialBadge';
        bar.innerHTML = ${JSON.stringify(html)};
        document.body.appendChild(bar);
      })();
    `)
    .catch(() => {});
}

// Small floating badge pinned to a screen corner (fixed, so it never reflows
// the app's own layout). Shared by the network-URL and attached-instance
// notices; the trial badge keeps its own copy because it carries links.
function injectCornerBadge(id, corner, html) {
  if (!mainWindow) return;
  mainWindow.webContents
    .insertCSS(
      `#${id} {
        position: fixed; ${corner} z-index: 2147483647;
        background: rgba(30,34,42,0.92); color: #fff;
        font: 12px -apple-system, "Segoe UI", sans-serif;
        padding: 8px 12px; border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      }`
    )
    .catch(() => {});
  mainWindow.webContents
    .executeJavaScript(
      `(function() {
        if (document.getElementById(${JSON.stringify(id)})) return;
        var bar = document.createElement('div');
        bar.id = ${JSON.stringify(id)};
        bar.innerHTML = ${JSON.stringify(html)};
        document.body.appendChild(bar);
      })();`
    )
    .catch(() => {});
}

// The URL other devices on the tailnet/LAN can reach this instance at. Only
// shown when HOST was set to something other than loopback. Plain text, not a
// link -- it's here to be typed into a phone, not clicked (clicking would just
// navigate this window to itself).
function injectNetworkBadge(url) {
  injectCornerBadge("__acsNetworkBadge", "top: 14px; left: 14px;", `<span>Network access: ${url}</span>`);
}

// Shown when this window is driving a server that was already running rather
// than one of our own (see the port check in whenReady). Worth saying out
// loud: the teams and terminals on screen belong to that instance, and closing
// this window leaves it running -- your phone keeps its session.
function injectAttachedBadge(url) {
  injectCornerBadge(
    "__acsAttachedBadge",
    "top: 14px; left: 14px;",
    `<span>Connected to the ACS AI Teams already running at ${url}</span>`
  );
}

async function createWindow(trialDaysLeft, attachedUrl) {
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
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === "acs-license:buy") {
      event.preventDefault();
      shell.openExternal(BUY_URL);
    } else if (url === "acs-license:activate") {
      event.preventDefault();
      reactivateFromBanner(app.getPath("userData"));
    }
  });
  if (typeof trialDaysLeft === "number") {
    mainWindow.webContents.once("did-finish-load", () => injectTrialBadge(trialDaysLeft));
  }
  // One badge, not two: when attached, the address on screen is the other
  // instance's, so the attached notice already names the URL a phone can use.
  const netUrl = attachedUrl || networkUrl();
  if (netUrl) {
    mainWindow.webContents.once("did-finish-load", () =>
      attachedUrl ? injectAttachedBadge(attachedUrl) : injectNetworkBadge(netUrl)
    );
  }
  mainWindow.loadURL(serverUrl);
}

app.whenReady().then(async () => {
  try {
    // Checked up front: if the port is unusable, say so before putting the
    // licence gate and the first-run folder picker in front of the user.
    const holder = await portHolder();
    if (holder.state === "stranger") {
      throw new Error(
        `Port ${PORT} is already in use by another program on this machine.\n\n` +
          `Close that program, or set the PORT environment variable to start ` +
          `ACS AI Teams on a different port.`
      );
    }

    // Attaching to an instance that is already serving: point the window at
    // the address it answered on (which may be a Tailscale IP, where loopback
    // has nothing listening) and skip starting a second server. Nothing else
    // changes -- the window talks HTTP/ws to it exactly as a browser tab does.
    const attachedUrl = holder.state === "ours" ? `http://${holder.host}:${PORT}` : null;
    if (attachedUrl) {
      serverUrl = attachedUrl;
      console.log(`attaching to the ACS AI Teams already running at ${attachedUrl}`);
    }

    const licenseResult = await ensureLicensed(app.getPath("userData"));
    if (!licenseResult.ok) {
      app.quit();
      return;
    }
    // The folder picker belongs to a server we are about to start; the running
    // instance already has its own teams location, so don't ask (or write
    // settings.json) on its behalf.
    if (!attachedUrl) {
      startServer(await resolveTeamsLocation(app.getPath("userData")));
    }
    await createWindow(licenseResult.trialDaysLeft, attachedUrl);
  } catch (err) {
    // A packaged app has no console to print to, so say it out loud.
    console.error(err.message);
    dialog.showErrorBox("ACS AI Teams could not start", err.message);
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
  // Guarded: when attached there is no server.js in this process to signal,
  // and the instance we attached to is a separate process that has to survive
  // this window closing.
  if (ownServerStarted) process.kill(process.pid, "SIGTERM");
});
