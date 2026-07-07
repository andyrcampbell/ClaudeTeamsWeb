// ACS AI Teams - local web backend.
// Port of the ClaudeTeams WinForms utility: manages team folders under a
// location and runs `claude` for each team.
//
// `claude` runs in embedded terminals on the web page. Each team's terminal is
// a long-lived pseudo-terminal SESSION on the server, independent of any single
// WebSocket, so you can keep several open at once, switch between them, and
// re-attach (reconnect). Session metadata + scrollback are persisted to disk so
// that after a server restart the terminals can be restored (as fresh claude
// sessions, with the previous transcript replayed as history).
//
// Runs on 127.0.0.1 only. It performs real filesystem operations and spawns
// processes on the host machine, so it is intentionally not exposed to the network.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec, execFile, spawn } = require("child_process");

let pty = null;
try {
  pty = require("node-pty");
} catch (err) {
  console.warn("node-pty unavailable - embedded terminal disabled, using external windows.\n ", err.message);
}
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const HOST = "127.0.0.1";
const PORT = process.env.PORT || 4173;
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const PTY_AVAILABLE = pty !== null;

const DEFAULT_LOCATION = IS_WIN
  ? "M:\\MyStuff\\MyAITeams\\"
  : path.join(os.homedir(), "MyAITeams");

const TEAM_SUBFOLDERS = ["Deliverables", "Team Register", "Team Task Data"];

// Persistence: where we remember open sessions + their scrollback.
const DATA_DIR = path.join(__dirname, "data");
const SCROLLBACK_DIR = path.join(DATA_DIR, "scrollback");
const REGISTRY_FILE = path.join(DATA_DIR, "sessions.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// Location chosen by the user, persisted across sessions (null until set).
let savedLocation = null;
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      if (s && typeof s.location === "string" && s.location.trim()) savedLocation = s.location;
    }
  } catch (err) {
    console.error("loadSettings error:", err.message);
  }
}

// Saved prompt templates (*.txt) shown in the Prompt dropdown.
const PROMPTS_DIR = path.join(__dirname, "Prompts");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules/@xterm")));

// --- helpers ---------------------------------------------------------------

function isValidTeamName(name) {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return false;
  if (trimmed.includes("..")) return false;
  if (/[:*?"<>|]/.test(trimmed)) return false;
  return true;
}

// Directory names under the location that are not teams and shouldn't appear
// in the Team Name dropdown.
const NON_TEAM_DIRS = new Set(["unassigned interviewees"]);

function listTeams(location) {
  if (!location || !fs.existsSync(location)) return [];
  return fs
    .readdirSync(location, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NON_TEAM_DIRS.has(d.name.toLowerCase()))
    .map((d) => d.name);
}

function ensureTeamFolders(teamDir) {
  const existed = fs.existsSync(teamDir);
  fs.mkdirSync(teamDir, { recursive: true });
  for (const sub of TEAM_SUBFOLDERS) {
    fs.mkdirSync(path.join(teamDir, sub), { recursive: true });
  }
  return existed;
}

// Launch `claude` in a separate OS terminal window (fallback + "detach").
function launchClaudeExternal(targetDir) {
  const onErr = (err) => err && console.error("launchClaudeExternal error:", err.message);
  if (IS_WIN) {
    const psCommand = `Set-Location '${targetDir.replace(/'/g, "''")}'; claude`;
    exec(`start "ACS AI Team" powershell -NoExit -Command "${psCommand}"`, { windowsHide: false }, onErr);
    return;
  }
  if (IS_MAC) {
    const shellCmd = `cd '${targetDir.replace(/'/g, "'\\''")}' && claude`;
    const appleScript = `tell application "Terminal"
  activate
  do script "${shellCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
end tell`;
    spawn("osascript", ["-e", appleScript], { stdio: "ignore", detached: true }).on("error", onErr);
    return;
  }
  const shellCmd = `cd '${targetDir.replace(/'/g, "'\\''")}' && claude; exec $SHELL`;
  const terminals = [
    ["x-terminal-emulator", ["-e", "bash", "-lc", shellCmd]],
    ["gnome-terminal", ["--", "bash", "-lc", shellCmd]],
    ["konsole", ["-e", "bash", "-lc", shellCmd]],
    ["xterm", ["-e", "bash", "-lc", shellCmd]],
  ];
  (function tryNext(i) {
    if (i >= terminals.length) return console.error("launchClaudeExternal: no terminal emulator found");
    const child = spawn(terminals[i][0], terminals[i][1], { stdio: "ignore", detached: true });
    child.on("error", () => tryNext(i + 1));
  })(0);
}

// Locate the Claude Desktop executable (Windows). Returns a path or null.
function findClaudeDesktopWin() {
  const la = process.env.LOCALAPPDATA || "";
  const pf = process.env.PROGRAMFILES || "";
  const candidates = [
    path.join(la, "AnthropicClaude", "claude.exe"),
    path.join(la, "Programs", "claude", "claude.exe"),
    path.join(la, "Programs", "Claude", "Claude.exe"),
    path.join(pf, "Claude", "Claude.exe"),
  ];
  // Squirrel-style versioned folders: %LOCALAPPDATA%\AnthropicClaude\app-x.y.z\claude.exe
  const anthropicDir = path.join(la, "AnthropicClaude");
  try {
    const appDirs = fs
      .readdirSync(anthropicDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith("app-"))
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const d of appDirs) candidates.push(path.join(anthropicDir, d, "claude.exe"));
  } catch {
    /* dir may not exist */
  }
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// --- persistence ------------------------------------------------------------

function ensureDataDir() {
  fs.mkdirSync(SCROLLBACK_DIR, { recursive: true });
}

function scrollbackPath(id) {
  return path.join(SCROLLBACK_DIR, `${id}.log`);
}

function writeRegistry() {
  try {
    const data = [...sessions.values()]
      .filter((s) => s.alive)
      .map((s) => ({ id: s.id, name: s.name, location: s.location }));
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("writeRegistry error:", err.message);
  }
}

function flushScrollback(session) {
  if (!session.dirty) return;
  try {
    fs.writeFileSync(scrollbackPath(session.id), session.buffer);
    session.dirty = false;
  } catch (err) {
    console.error("flushScrollback error:", err.message);
  }
}

function removeScrollback(id) {
  try {
    fs.rmSync(scrollbackPath(id), { force: true });
  } catch {
    /* ignore */
  }
}

// --- terminal session manager ----------------------------------------------
// A session is a team's terminal. `live` means the pty is running; a session
// loaded from disk after a restart is "dormant" (live=false) until re-attached,
// at which point its pty is (re)spawned and the saved transcript is replayed.

const sessions = new Map(); // id -> session
let sessionSeq = 0;
const MAX_SCROLLBACK = 256 * 1024;
const MAX_SESSIONS = 16;
const RESTORE_BANNER =
  "\r\n\x1b[33m── restored after server restart — new claude session; transcript above is from before ──\x1b[0m\r\n";

function killSessionsByDir(teamDir) {
  for (const s of [...sessions.values()]) if (s.alive && s.teamDir === teamDir) killSession(s.id);
}

function ptyCommand() {
  const shell = IS_WIN ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  const args = IS_WIN ? ["-NoExit", "-Command", "claude"] : ["-i", "-c", `claude; exec "${shell}" -i`];
  return { shell, args };
}

// Spawn (or respawn) the pty for a session and wire its I/O.
function spawnPty(session) {
  ensureTeamFolders(session.teamDir);
  const { shell, args } = ptyCommand();
  const term = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: session.teamDir,
    env: { ...process.env, TERM: "xterm-256color" },
  });
  session.term = term;
  session.live = true;

  term.onData((data) => {
    // Track whether the app (claude) has bracketed-paste mode enabled, so we
    // know whether to frame pasted text with the paste markers. The first time
    // it turns on, claude's input is ready — a good moment to run /rename.
    if (data.indexOf("\x1b[?2004h") !== -1) {
      session.bracketedPaste = true;
      if (session.pendingRename && !session.renameScheduled) {
        session.renameScheduled = true;
        const newName = session.pendingRename;
        session.pendingRename = null;
        // Let claude finish rendering its startup UI, then type the command.
        setTimeout(() => typeCommand(session, `/rename ${newName}`), 3500);
      }
    } else if (data.indexOf("\x1b[?2004l") !== -1) {
      session.bracketedPaste = false;
    }

    session.buffer += data;
    if (session.buffer.length > MAX_SCROLLBACK) {
      session.buffer = session.buffer.slice(session.buffer.length - MAX_SCROLLBACK);
    }
    session.dirty = true;
    for (const ws of session.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  });

  term.onExit(() => {
    session.alive = false;
    session.live = false;
    for (const ws of session.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
        ws.close(4000, "ended");
      }
    }
    sessions.delete(session.id);
    removeScrollback(session.id);
    writeRegistry();
  });
}

// Write a block of text to a session's pty as a paste. Chunked and paced so a
// large block isn't truncated by the terminal input buffer (notably Windows
// ConPTY), and wrapped in bracketed-paste markers when the app supports them
// (so the whole block is treated as one paste, not line-by-line input).
function writePaste(session, text) {
  if (!session.term) return;
  const START = "\x1b[200~";
  const END = "\x1b[201~";
  const payload = session.bracketedPaste ? START + text + END : text;
  const CHUNK = 200;
  let i = 0;
  (function next() {
    if (i >= payload.length || !session.term) return;
    try {
      session.term.write(payload.slice(i, i + CHUNK));
    } catch {
      return;
    }
    i += CHUNK;
    setTimeout(next, 6);
  })();
}

// Type a command into the pty slowly, then press Enter. Paced in small chunks
// so characters aren't dropped while claude's TUI is still settling.
function typeCommand(session, text) {
  const CHUNK = 5;
  let i = 0;
  (function next() {
    if (!session.term) return;
    if (i < text.length) {
      try {
        session.term.write(text.slice(i, i + CHUNK));
      } catch {
        return;
      }
      i += CHUNK;
      setTimeout(next, 28);
    } else {
      setTimeout(() => {
        try {
          if (session.term) session.term.write("\r");
        } catch {
          /* ended */
        }
      }, 350);
    }
  })();
}

function createSession(location, name, sessionName) {
  const teamDir = path.join(location, name.trim());
  ensureTeamFolders(teamDir);

  // Always create a new session, even if this team already has one open — each
  // Create/Activate opens an additional terminal for the team.
  const liveCount = [...sessions.values()].filter((s) => s.alive).length;
  if (liveCount >= MAX_SESSIONS) {
    throw new Error(`Too many open terminals (max ${MAX_SESSIONS}). Close one first.`);
  }

  const id = `s${++sessionSeq}`;
  const session = {
    id,
    name: name.trim(),
    location,
    teamDir,
    term: null,
    buffer: "",
    clients: new Set(),
    alive: true,
    live: false,
    dirty: false,
    needsRestoreBanner: false,
    // If a session name was given, run `/rename <name>` once claude is ready.
    pendingRename: typeof sessionName === "string" && sessionName.trim() ? sessionName.trim() : null,
    renameScheduled: false,
  };
  sessions.set(id, session);
  spawnPty(session);
  writeRegistry();
  return { session, reused: false };
}

// Bring a dormant (post-restart) session back to life.
function reviveSession(session) {
  if (session.live) return;
  if (session.needsRestoreBanner) {
    session.buffer += RESTORE_BANNER;
    session.needsRestoreBanner = false;
  }
  spawnPty(session);
  writeRegistry();
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  s.alive = false;
  if (s.live && s.term) {
    try {
      s.term.kill();
    } catch {
      /* already gone */
    }
  }
  sessions.delete(id);
  removeScrollback(id);
  writeRegistry();
}

// Load persisted sessions from disk as dormant records.
function loadPersistedSessions() {
  let entries = [];
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      entries = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    }
  } catch (err) {
    console.error("loadPersistedSessions parse error:", err.message);
    return;
  }
  for (const e of entries) {
    if (!e || !e.id || !e.name || !e.location) continue;
    const teamDir = path.join(e.location, e.name);
    let buffer = "";
    try {
      if (fs.existsSync(scrollbackPath(e.id))) buffer = fs.readFileSync(scrollbackPath(e.id), "utf8");
    } catch {
      /* ignore */
    }
    sessions.set(e.id, {
      id: e.id,
      name: e.name,
      location: e.location,
      teamDir,
      term: null,
      buffer,
      clients: new Set(),
      alive: true,
      live: false,
      dirty: false,
      needsRestoreBanner: true,
    });
    const n = parseInt(String(e.id).replace(/^s/, ""), 10);
    if (Number.isFinite(n) && n > sessionSeq) sessionSeq = n;
  }
  if (entries.length) console.log(`  Restored ${sessions.size} persisted terminal session(s) from disk.`);
}

// --- REST API ---------------------------------------------------------------

app.get("/api/config", (req, res) => {
  res.json({ defaultLocation: savedLocation || DEFAULT_LOCATION, ptyAvailable: PTY_AVAILABLE });
});

// Persist the chosen location so it is remembered across sessions.
app.post("/api/settings/location", (req, res) => {
  const { location } = req.body || {};
  if (typeof location !== "string" || !location.trim()) {
    return res.status(400).json({ error: "Invalid location." });
  }
  try {
    savedLocation = location;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ location: savedLocation }, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/teams", (req, res) => {
  const location = req.query.location || "";
  try {
    res.json({ teams: listTeams(location), exists: fs.existsSync(location) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A prompt "category" is a subdirectory of Prompts/ (empty string = top level).
// Resolve it safely to an absolute directory inside PROMPTS_DIR.
function promptCategoryDir(category) {
  const c = typeof category === "string" ? category.trim() : "";
  if (!c) return PROMPTS_DIR;
  if (c.includes("/") || c.includes("\\") || c.includes("..") || /[:*?"<>|]/.test(c)) {
    throw new Error("Invalid category.");
  }
  const dir = path.join(PROMPTS_DIR, c);
  if (!path.resolve(dir).startsWith(path.resolve(PROMPTS_DIR) + path.sep)) {
    throw new Error("Invalid category.");
  }
  return dir;
}

function isValidPromptName(name) {
  return (
    typeof name === "string" &&
    name.trim() &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..") &&
    !/[:*?"<>|]/.test(name)
  );
}

// List the prompt categories (subdirectories of Prompts/).
app.get("/api/prompt-categories", (req, res) => {
  try {
    if (!fs.existsSync(PROMPTS_DIR)) return res.json({ categories: [] });
    const categories = fs
      .readdirSync(PROMPTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List saved prompt templates in a category (file names without .txt).
app.get("/api/prompts", (req, res) => {
  try {
    const dir = promptCategoryDir(req.query.category);
    if (!fs.existsSync(dir)) return res.json({ prompts: [] });
    const prompts = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".txt"))
      .map((d) => d.name.slice(0, -4))
      .sort((a, b) => a.localeCompare(b));
    res.json({ prompts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Save (create or overwrite) a prompt template in the given category.
app.post("/api/prompts", (req, res) => {
  const { name, content, category } = req.body || {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Please provide a prompt name." });
  }
  const trimmed = name.trim();
  if (!isValidPromptName(trimmed)) {
    return res.status(400).json({ error: "Invalid prompt name (no / \\ .. : * ? \" < > |)." });
  }
  if (typeof content !== "string") {
    return res.status(400).json({ error: "Missing prompt content." });
  }
  try {
    const dir = promptCategoryDir(category);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${trimmed}.txt`), content, "utf8");
    res.json({ name: trimmed, category: (category || "").trim() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a saved prompt file from a category.
app.delete("/api/prompts/:name", (req, res) => {
  const name = req.params.name || "";
  if (!isValidPromptName(name)) return res.status(400).json({ error: "Invalid prompt name." });
  try {
    const dir = promptCategoryDir(req.query.category);
    const filePath = path.join(dir, `${name}.txt`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Prompt not found." });
    fs.rmSync(filePath, { force: true });
    res.json({ name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Return the text of a saved prompt in a category.
app.get("/api/prompts/:name", (req, res) => {
  const name = req.params.name || "";
  if (!isValidPromptName(name)) return res.status(400).json({ error: "Invalid prompt name." });
  try {
    const dir = promptCategoryDir(req.query.category);
    const filePath = path.join(dir, `${name}.txt`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Prompt not found." });
    res.json({ name, content: fs.readFileSync(filePath, "utf8") });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/terminal/sessions", (req, res) => {
  if (!PTY_AVAILABLE) return res.status(400).json({ error: "Embedded terminal not available." });
  const { location, name, sessionName } = req.body || {};
  if (!location || !fs.existsSync(location)) {
    return res.status(400).json({ error: "Location folder does not exist." });
  }
  if (!isValidTeamName(name)) {
    return res.status(400).json({ error: "Please enter a valid team name." });
  }
  try {
    const teamDir = path.join(location, name.trim());
    const folderExisted = fs.existsSync(teamDir);
    const { session, reused } = createSession(location, name, sessionName);
    res.json({ id: session.id, name: session.name, location: session.location, reused, created: !folderExisted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/terminal/sessions", (req, res) => {
  res.json({
    sessions: [...sessions.values()]
      .filter((s) => s.alive)
      .map((s) => ({ id: s.id, name: s.name, location: s.location, live: s.live })),
  });
});

// Detach: move a team's terminal out to a separate OS window. This ends the
// embedded session and starts a FRESH claude in a native terminal (a running
// claude can't be transferred between processes).
app.post("/api/terminal/detach", (req, res) => {
  const { id, location, name } = req.body || {};
  // Prefer the exact session by id (a team may have several terminals). Fall
  // back to location/name so a tab whose session already ended can still detach.
  const session = id ? sessions.get(id) : null;
  const teamDir = session
    ? session.teamDir
    : location && isValidTeamName(name)
    ? path.join(location, name.trim())
    : null;
  if (!teamDir) {
    return res.status(400).json({ error: "Invalid session or team name." });
  }
  if (!fs.existsSync(teamDir)) {
    return res.status(400).json({ error: "Team directory does not exist." });
  }
  try {
    if (session) killSession(session.id); // end only this terminal
    launchClaudeExternal(teamDir);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Open the Claude Desktop app. Handles both the classic installer build and the
// Microsoft Store (MSIX) build, which can't be launched by exe path.
app.post("/api/open-claude-desktop", (req, res) => {
  const notFound = () =>
    res.status(404).json({ error: "Claude Desktop not found. Open it manually, or install it from claude.ai/download." });

  if (IS_WIN) {
    // 1) Classic installer build: launch the exe directly.
    const exe = findClaudeDesktopWin();
    if (exe) {
      spawn(exe, [], { detached: true, stdio: "ignore" }).on("error", () => {});
      return res.json({ ok: true, method: "exe", path: exe });
    }
    // 2) Store/MSIX build: find the Start-menu AppID and launch via AppsFolder.
    const ps =
      "$a = Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1; " +
      "if ($a) { Start-Process ('shell:AppsFolder\\' + $a.AppID); exit 0 } else { exit 3 }";
    return execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      (err) => {
        if (!err) return res.json({ ok: true, method: "store" });
        exec('start "" claude://', () => {}); // 3) last resort: URL protocol
        notFound();
      }
    );
  }

  if (IS_MAC) {
    return exec('open -a "Claude"', (err) => (err ? notFound() : res.json({ ok: true, method: "open" })));
  }
  // Linux
  return exec("claude-desktop || xdg-open claude://", (err) =>
    err ? notFound() : res.json({ ok: true, method: "linux" })
  );
});

// Open the OS-native folder picker and return the selected absolute path.
// (A browser can't return a real filesystem path, so the local backend does it.)
app.post("/api/browse-folder", (req, res) => {
  const initial = (req.body && req.body.current) || DEFAULT_LOCATION;

  if (IS_WIN) {
    // Windows PowerShell (STA) FolderBrowserDialog, brought to front via a
    // topmost invisible owner form. Initial path passed via env to avoid quoting.
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dlg.Description = 'Select the AI Teams location folder'",
      "$dlg.ShowNewFolderButton = $true",
      "if ($env:ACS_INITIAL -and (Test-Path $env:ACS_INITIAL)) { $dlg.SelectedPath = $env:ACS_INITIAL }",
      "$owner = New-Object System.Windows.Forms.Form",
      "$owner.TopMost = $true; $owner.Width = 1; $owner.Height = 1; $owner.Opacity = 0; $owner.StartPosition = 'CenterScreen'",
      "$owner.Show(); $owner.Activate()",
      "$r = $dlg.ShowDialog($owner)",
      "$owner.Close()",
      "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }",
    ].join("\n");
    return execFile(
      "powershell.exe",
      ["-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { env: { ...process.env, ACS_INITIAL: initial }, windowsHide: true },
      (err, stdout) => {
        if (err) return res.status(500).json({ error: "Folder picker failed to open." });
        const p = (stdout || "").trim();
        return p ? res.json({ path: p }) : res.json({ cancelled: true });
      }
    );
  }

  if (IS_MAC) {
    const script =
      'try\n set f to choose folder with prompt "Select the AI Teams location folder"\n POSIX path of f\nend try';
    return execFile("osascript", ["-e", script], (err, stdout) => {
      const p = (stdout || "").trim();
      return p ? res.json({ path: p }) : res.json({ cancelled: true });
    });
  }

  // Linux: zenity if available.
  return execFile(
    "zenity",
    ["--file-selection", "--directory", "--title=Select the AI Teams location folder"],
    (err, stdout) => {
      const p = (stdout || "").trim();
      if (p) return res.json({ path: p });
      if (err && err.code === undefined) return res.status(500).json({ error: "No folder picker available (install zenity)." });
      return res.json({ cancelled: true });
    }
  );
});

// Fallback flow (no node-pty): create folders + launch claude in a separate
// OS window. Mirrors the original Button1_Click.
app.post("/api/teams/launch", (req, res) => {
  const { location, name } = req.body || {};
  if (!location || !fs.existsSync(location)) {
    return res.status(400).json({ error: "Location folder does not exist." });
  }
  if (!isValidTeamName(name)) {
    return res.status(400).json({ error: "Please enter a valid team name." });
  }
  try {
    const teamDir = path.join(location, name.trim());
    const existed = ensureTeamFolders(teamDir);
    launchClaudeExternal(teamDir);
    res.json({
      status: existed ? "activated" : "created",
      message: existed
        ? "Directory already exists. Activating Claude Team in that directory."
        : "Creating team directory structure and starting Claude.",
      team: name.trim(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/teams/delete", (req, res) => {
  const { location, name } = req.body || {};
  if (!location || !isValidTeamName(name)) {
    return res.status(400).json({ error: "Invalid location or team name." });
  }
  const teamDir = path.join(location, name.trim());
  try {
    killSessionsByDir(teamDir); // end every terminal for this team so nothing locks the folder
    if (fs.existsSync(teamDir)) {
      fs.rmSync(teamDir, { recursive: true, force: true });
    }
    res.json({ status: "deleted", team: name.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/teams/open", (req, res) => {
  const { location, name } = req.body || {};
  if (!location || !isValidTeamName(name)) {
    return res.status(400).json({ error: "Invalid location or team name." });
  }
  const teamDir = path.join(location, name.trim());
  if (!fs.existsSync(teamDir)) {
    return res.status(400).json({ error: "Team directory does not exist." });
  }
  const opener = IS_WIN ? "explorer" : IS_MAC ? "open" : "xdg-open";
  spawn(opener, [teamDir], { stdio: "ignore", detached: true }).on("error", () => {});
  res.json({ status: "opened", team: name.trim() });
});

// --- team members (roster cards) -------------------------------------------

// Parse a member's name + role from their Team/*.md profile.
function parseMemberProfile(mdText, fallbackName) {
  const fullName = mdText.match(/\*\*Full name:\*\*\s*(.+)/i);
  const roleLine = mdText.match(/\*\*Role:\*\*\s*(.+)/i);
  // Heading like: "# Mary — HR Director"
  const heading = mdText.match(/^#\s+(.+?)\s+[—–-]\s+(.+?)\s*$/m);
  const name = (fullName ? fullName[1] : heading ? heading[1] : fallbackName).replace(/\s+$/, "").trim();
  const role = (roleLine ? roleLine[1] : heading ? heading[2] : "").replace(/\s+$/, "").trim();
  return { name, role, isProfile: !!(roleLine || heading) };
}

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

// List a team's members from its /Team/*.md profiles, matched to /Team Gallery images.
app.get("/api/team-members", (req, res) => {
  const location = req.query.location || "";
  const name = req.query.name || "";
  if (!location || !isValidTeamName(name)) {
    return res.status(400).json({ error: "Invalid location or team name." });
  }
  const teamDir = path.join(location, name.trim());
  const profilesDir = path.join(teamDir, "Team");
  const galleryDir = path.join(teamDir, "Team Gallery");
  try {
    if (!fs.existsSync(profilesDir)) return res.json({ members: [] });

    // Map lowercased image base name -> actual filename.
    const gallery = {};
    if (fs.existsSync(galleryDir)) {
      for (const f of fs.readdirSync(galleryDir)) {
        const ext = path.extname(f).toLowerCase();
        if (IMAGE_EXTS.includes(ext)) gallery[path.basename(f, path.extname(f)).toLowerCase()] = f;
      }
    }

    const members = [];
    for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const base = entry.name.slice(0, -3);
      const low = base.toLowerCase();
      if (low === "roster" || low === "hiring-log") continue;
      let parsed;
      try {
        parsed = parseMemberProfile(fs.readFileSync(path.join(profilesDir, entry.name), "utf8"), base);
      } catch {
        continue;
      }
      if (!parsed.isProfile) continue; // skip non-profile markdown
      members.push({ name: parsed.name, role: parsed.role, image: gallery[low] || null });
    }
    members.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve a team member's gallery image.
app.get("/api/team-member-image", (req, res) => {
  const location = req.query.location || "";
  const name = req.query.name || "";
  const file = req.query.file || "";
  if (!location || !isValidTeamName(name)) return res.status(400).end();
  if (!file || file.includes("/") || file.includes("\\") || file.includes("..")) return res.status(400).end();
  const galleryDir = path.join(location, name.trim(), "Team Gallery");
  const filePath = path.join(galleryDir, file);
  if (!path.resolve(filePath).startsWith(path.resolve(galleryDir) + path.sep)) return res.status(400).end();
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(path.resolve(filePath));
});

// --- WebSocket: attach to a terminal session --------------------------------

const ALLOWED_ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];

if (PTY_AVAILABLE) {
  const wss = new WebSocketServer({ server, path: "/terminal" });

  wss.on("connection", (ws, req) => {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      ws.close(1008, "Forbidden origin");
      return;
    }

    let id;
    try {
      id = new URL(req.url, "http://localhost").searchParams.get("id");
    } catch {
      ws.close(1008, "Bad request");
      return;
    }

    const session = sessions.get(id);
    if (!session || !session.alive) {
      ws.send("\r\n\x1b[90m[ACS] Session not found or already ended.\x1b[0m\r\n");
      ws.close();
      return;
    }

    // Dormant session (loaded from disk after a restart) -> respawn claude now.
    if (!session.live) {
      try {
        reviveSession(session);
      } catch (err) {
        ws.send(`\r\n[ACS] Could not restore session: ${err.message}\r\n`);
        ws.close();
        return;
      }
    }

    session.clients.add(ws);
    if (session.buffer && ws.readyState === ws.OPEN) ws.send(session.buffer);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "input" && typeof msg.data === "string") {
        if (session.term) session.term.write(msg.data);
      } else if (msg.type === "paste" && typeof msg.data === "string") {
        writePaste(session, msg.data);
      } else if (msg.type === "resize" && msg.cols > 0 && msg.rows > 0) {
        try {
          session.term && session.term.resize(msg.cols, msg.rows);
        } catch {
          /* ignore transient resize errors */
        }
      } else if (msg.type === "kill") {
        killSession(id);
      }
    });

    // Closing a socket only DETACHES; the pty keeps running.
    ws.on("close", () => {
      session.clients.delete(ws);
    });
  });
}

// --- lifecycle --------------------------------------------------------------

ensureDataDir();
loadSettings();
loadPersistedSessions();

// Periodically flush scrollback so a hard kill still leaves recent history.
const flushTimer = setInterval(() => {
  for (const s of sessions.values()) flushScrollback(s);
}, 3000);
flushTimer.unref?.();

function shutdown() {
  for (const s of sessions.values()) flushScrollback(s);
  writeRegistry();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`\n  ACS AI Teams running at  http://${HOST}:${PORT}`);
  console.log(`  Embedded terminal: ${PTY_AVAILABLE ? "enabled" : "disabled (external windows)"}\n`);
});
