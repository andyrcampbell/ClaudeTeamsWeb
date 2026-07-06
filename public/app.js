// ACS AI Teams - frontend logic. Talks to the local Node backend for all
// filesystem / process operations, mirroring the WinForms button handlers.
// When node-pty is available, claude runs in an embedded xterm.js terminal;
// otherwise it falls back to launching a separate OS terminal window.

const $ = (id) => document.getElementById(id);
const locationInput = $("location");
const teamNameInput = $("teamName");
const teamList = $("teamList");

let ptyAvailable = false;

// --- toast helper ----------------------------------------------------------
let toastTimer;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// --- team list -------------------------------------------------------------
async function refreshTeams() {
  const location = locationInput.value.trim();
  if (!location) return;
  try {
    const { teams } = await api(`/api/teams?location=${encodeURIComponent(location)}`);
    teamList.innerHTML = "";
    for (const name of teams) {
      const opt = document.createElement("option");
      opt.value = name;
      teamList.appendChild(opt);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

// --- embedded terminals (tabbed, multi-session) ----------------------------
// Each open team terminal is a "tab": one xterm + one WebSocket attached to a
// server-side pty session. Sessions live on the server, so tabs survive
// switching between them and can be re-attached after a page reload.

const tabs = new Map(); // sessionId -> { id, name, term, fit, ws, tabEl, paneEl, ended }
let activeTabId = null;

const TERM_OPTS = {
  cursorBlink: true,
  fontFamily: 'Consolas, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace',
  fontSize: 14,
  theme: { background: "#0c0c14" },
};

function wsUrl(id) {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/terminal?id=${encodeURIComponent(id)}`;
}

function showOverlay() {
  $("terminalOverlay").hidden = false;
  $("terminalRestore").hidden = true;
  if (activeTabId) fitTab(activeTabId);
}

function hideOverlay() {
  $("terminalOverlay").hidden = true;
  updateRestorePill();
}

function updateRestorePill() {
  const pill = $("terminalRestore");
  const overlayHidden = $("terminalOverlay").hidden;
  if (tabs.size > 0 && overlayHidden) {
    pill.textContent = `▸ Terminals (${tabs.size})`;
    pill.hidden = false;
  } else {
    pill.hidden = true;
  }
}

// Rebuild the main-UI "Open Terminals" dropdown from the current set of tabs.
// Called whenever a tab is added, removed, ended, or activated.
function updateOpenTerminalsDropdown() {
  const sel = $("openTerminalsSelect");
  sel.innerHTML = "";
  if (tabs.size === 0) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "No open terminals";
    sel.appendChild(o);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const [id, t] of tabs) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = t.ended ? `${t.label} (ended)` : t.label;
    sel.appendChild(o);
  }
  if (activeTabId && tabs.has(activeTabId)) sel.value = activeTabId;
}

function fitTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  try {
    t.fit.fit();
    if (t.ws && t.ws.readyState === WebSocket.OPEN) {
      t.ws.send(JSON.stringify({ type: "resize", cols: t.term.cols, rows: t.term.rows }));
    }
  } catch {}
}

function activateTab(id) {
  activeTabId = id;
  for (const [tid, t] of tabs) {
    const on = tid === id;
    t.tabEl.classList.toggle("active", on);
    t.paneEl.classList.toggle("active", on);
  }
  const t = tabs.get(id);
  if (t) {
    fitTab(id);
    t.term.focus();
  }
  const sel = $("openTerminalsSelect");
  if (sel && tabs.has(id)) sel.value = id;
}

// Build the tab button + pane, spin up xterm, and attach the WebSocket.
function createTab(id, name, location) {
  // Tab button
  const tabEl = document.createElement("div");
  tabEl.className = "term-tab";
  tabEl.dataset.id = id;
  const nameEl = document.createElement("span");
  nameEl.className = "term-tab-name";
  // If this team already has terminals open, number the new one so tabs are
  // distinguishable (e.g. "ACS-AI", "ACS-AI (2)", "ACS-AI (3)").
  const sameTeam = [...tabs.values()].filter((t) => t.name === name).length;
  const label = sameTeam === 0 ? name : `${name} (${sameTeam + 1})`;
  nameEl.textContent = label;
  const detachEl = document.createElement("button");
  detachEl.className = "term-tab-btn term-tab-detach";
  detachEl.innerHTML = "&#8599;"; // ↗ pop out
  detachEl.title = "Detach to a separate OS window (starts a fresh claude)";
  const closeEl = document.createElement("button");
  closeEl.className = "term-tab-btn term-tab-close";
  closeEl.innerHTML = "&times;";
  closeEl.title = "Close this terminal";
  tabEl.append(nameEl, detachEl, closeEl);
  $("terminalTabs").appendChild(tabEl);

  tabEl.addEventListener("click", (e) => {
    if (e.target === closeEl || e.target === detachEl) return;
    activateTab(id);
  });
  detachEl.addEventListener("click", (e) => {
    e.stopPropagation();
    detachTab(id);
  });
  closeEl.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(id, true);
  });

  // Pane + xterm
  const paneEl = document.createElement("div");
  paneEl.className = "term-pane";
  paneEl.dataset.id = id;
  $("terminalPanes").appendChild(paneEl);

  const term = new Terminal(TERM_OPTS);
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(paneEl);

  const entry = { id, name, label, location, term, fit, ws: null, tabEl, paneEl, ended: false };
  tabs.set(id, entry);
  updateOpenTerminalsDropdown();

  // Show it before fitting so xterm gets real dimensions.
  activateTab(id);

  // Attach WebSocket to the server session.
  const ws = new WebSocket(wsUrl(id));
  entry.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  ws.onmessage = (ev) => term.write(ev.data);
  ws.onclose = () => {
    // Distinguish a user-initiated close (tab already removed) from the pty
    // ending on its own.
    if (tabs.has(id) && !entry.ended) markTabEnded(id);
  };
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
  });

  updateRestorePill();
  return entry;
}

function markTabEnded(id) {
  const t = tabs.get(id);
  if (!t) return;
  t.ended = true;
  t.tabEl.classList.add("ended");
  try { t.term.write("\r\n\x1b[90m[session ended — close this tab]\x1b[0m\r\n"); } catch {}
  updateOpenTerminalsDropdown();
}

// Close a tab. userKill=true tells the server to end the pty; otherwise we just
// tear down the client (used when the session already ended).
function closeTab(id, userKill) {
  const t = tabs.get(id);
  if (!t) return;
  if (userKill && t.ws && t.ws.readyState === WebSocket.OPEN) {
    try { t.ws.send(JSON.stringify({ type: "kill" })); } catch {}
  }
  try { t.ws && t.ws.close(); } catch {}
  try { t.term.dispose(); } catch {}
  t.tabEl.remove();
  t.paneEl.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const next = tabs.keys().next();
    activeTabId = null;
    if (!next.done) activateTab(next.value);
  }
  if (tabs.size === 0) $("terminalOverlay").hidden = true;
  updateRestorePill();
  updateOpenTerminalsDropdown();
}

// Detach a tab to a separate OS terminal window (fresh claude), close the tab.
async function detachTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  try {
    await api("/api/terminal/detach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, location: t.location, name: t.name }),
    });
    // The server already ended the embedded session; tear down the tab locally.
    closeTab(id, false);
    toast(`Opened "${t.name}" in a separate window (fresh claude session).`);
  } catch (err) {
    toast(err.message, true);
  }
}

// Open a new terminal for a team. Every call creates an additional terminal,
// even if the team already has one (each gets its own tab).
async function openTeamTerminal(location, name) {
  const data = await api("/api/terminal/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location, name }),
  });
  showOverlay();
  createTab(data.id, data.name, data.location);
  toast(data.created ? "Team created. Starting Claude…" : `Opened a terminal for "${data.name}".`);
}

// Restore tabs for sessions already running on the server (e.g. after reload).
async function restoreSessions() {
  if (!ptyAvailable) return;
  try {
    const { sessions } = await api("/api/terminal/sessions");
    if (!sessions.length) return;
    for (const s of sessions) {
      if (!tabs.has(s.id)) createTab(s.id, s.name, s.location);
    }
    $("terminalOverlay").hidden = true; // don't steal focus on load; offer the pill
    updateRestorePill();
  } catch {}
}

$("terminalMinimize").addEventListener("click", hideOverlay);
$("terminalRestore").addEventListener("click", showOverlay);
// Selecting a terminal from the main-UI dropdown opens it and switches to it.
$("openTerminalsSelect").addEventListener("change", (e) => {
  const id = e.target.value;
  if (id && tabs.has(id)) {
    showOverlay();
    activateTab(id);
  }
});

// Selecting a slash command types it into the currently-selected terminal (not
// auto-submitted, so you can add arguments and press Enter).
$("slashSelect").addEventListener("change", (e) => {
  const cmd = e.target.value;
  e.target.selectedIndex = 0; // reset so the same command can be picked again
  if (!cmd) return;
  const id = $("openTerminalsSelect").value;
  if (!id || !tabs.has(id)) return toast("Select an open terminal first.", true);
  const t = tabs.get(id);
  if (t.ended || !t.ws || t.ws.readyState !== WebSocket.OPEN) {
    return toast("That terminal is not connected.", true);
  }
  t.ws.send(JSON.stringify({ type: "input", data: cmd }));
  showOverlay();
  activateTab(id);
  toast(`Typed ${cmd} into "${t.label}" — press Enter to run.`);
});
window.addEventListener("resize", () => {
  if (!$("terminalOverlay").hidden && activeTabId) fitTab(activeTabId);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("terminalOverlay").hidden) hideOverlay();
});

// --- location lock / browse ------------------------------------------------
const lockBrowse = document.querySelector(".lock-browse");

function lockLocation() {
  locationInput.readOnly = true;
  lockBrowse.classList.remove("unlocked"); // Lock/Unlock button to the front
}
function unlockLocation() {
  locationInput.readOnly = false;
  lockBrowse.classList.add("unlocked"); // Browse button to the front
}

async function saveLocation(loc) {
  try {
    await api("/api/settings/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: loc }),
    });
  } catch {
    /* non-fatal: still works this session, just won't persist */
  }
}

// Locked -> clicking Lock/Unlock unlocks and reveals Browse.
$("lockBtn").addEventListener("click", () => {
  unlockLocation();
  locationInput.focus();
});

// Unlocked -> Browse opens the OS folder picker; on selection, update + re-lock.
$("browseBtn").addEventListener("click", async () => {
  try {
    const data = await api("/api/browse-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: locationInput.value }),
    });
    if (data.cancelled) return; // stay unlocked so they can try again
    locationInput.value = data.path;
    lockLocation();
    await saveLocation(data.path);
    await refreshTeams();
    toast("Location updated.");
  } catch (err) {
    toast(err.message, true);
  }
});

// Manual edit (typing a path then blurring while unlocked): persist + re-lock.
locationInput.addEventListener("change", async () => {
  await refreshTeams();
  await saveLocation(locationInput.value);
  lockLocation();
});
$("refreshBtn").addEventListener("click", () => {
  teamNameInput.value = ""; // clear the team-name selection on manual refresh
  refreshTeams();
});

// --- create / activate -----------------------------------------------------
$("createBtn").addEventListener("click", async () => {
  const location = locationInput.value.trim();
  const name = teamNameInput.value.trim();
  if (!name) return toast("Please enter a team name.", true);

  try {
    if (ptyAvailable) {
      // Open a new embedded terminal tab running claude for this team.
      await openTeamTerminal(location, name);
      await refreshTeams();
    } else {
      // Fallback: server launches claude in a separate OS window.
      const data = await api("/api/teams/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, name }),
      });
      toast(data.message);
      await refreshTeams();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

// --- delete ----------------------------------------------------------------
$("deleteBtn").addEventListener("click", async () => {
  const location = locationInput.value.trim();
  const name = teamNameInput.value.trim();
  if (!name) return toast("Please enter a team name.", true);
  const ok = confirm(
    "Are you Absolutely Sure You Want to Delete this Team? This action cannot be undone."
  );
  if (!ok) return;
  try {
    await api("/api/teams/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location, name }),
    });
    toast(`Deleted team "${name}".`);
    teamNameInput.value = "";
    await refreshTeams();
  } catch (err) {
    toast(err.message, true);
  }
});

// --- send text to selected terminal ----------------------------------------
$("sendTextBtn").addEventListener("click", () => {
  const id = $("openTerminalsSelect").value;
  if (!id || !tabs.has(id)) return toast("Select an open terminal first.", true);
  const t = tabs.get(id);
  if (t.ended || !t.ws || t.ws.readyState !== WebSocket.OPEN) {
    return toast("That terminal is not connected.", true);
  }
  const text = $("prompt").value;
  if (!text) return toast("The text box is empty.", true);

  // Send as a paste (chunked + bracketed on the server) so long text isn't
  // truncated by the terminal input buffer. Then reveal the terminal so the
  // user can review and press Enter to submit.
  t.ws.send(JSON.stringify({ type: "paste", data: text }));
  showOverlay();
  activateTab(id);
  toast(`Sent text to "${t.label}".`);
});

// --- open Claude Desktop ---------------------------------------------------
$("claudeDesktopBtn").addEventListener("click", async () => {
  toast("Opening Claude Desktop…"); // immediate feedback; the lookup can take a moment
  try {
    await api("/api/open-claude-desktop", { method: "POST" });
  } catch (err) {
    toast(err.message, true);
  }
});

// --- view team directory ---------------------------------------------------
$("viewDirBtn").addEventListener("click", async () => {
  const location = locationInput.value.trim();
  const name = teamNameInput.value.trim();
  if (!name) return toast("Please select a team first.", true);
  try {
    await api("/api/teams/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location, name }),
    });
  } catch (err) {
    toast(err.message, true);
  }
});

// --- saved prompt templates ------------------------------------------------
async function loadPromptList() {
  try {
    const { prompts } = await api("/api/prompts");
    const sel = $("promptSelect");
    sel.length = 1; // keep the placeholder option, drop the rest
    for (const name of prompts) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    }
  } catch {
    /* non-fatal: leave the dropdown with just its placeholder */
  }
}

// Save the current text box as a prompt template in the Prompts folder.
$("savePromptBtn").addEventListener("click", async () => {
  const content = $("prompt").value;
  if (!content.trim()) return toast("Nothing to save — the text box is empty.", true);

  const suggested = $("promptSelect").value || "";
  const name = window.prompt("Save prompt as:", suggested);
  if (name === null) return; // cancelled
  const trimmed = name.trim();
  if (!trimmed) return toast("Please enter a name.", true);

  const exists = [...$("promptSelect").options].some((o) => o.value === trimmed);
  if (exists && !confirm(`A prompt named "${trimmed}" already exists. Overwrite it?`)) return;

  try {
    const data = await api("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, content }),
    });
    await loadPromptList();
    $("promptSelect").value = data.name; // select the just-saved prompt
    toast(`Saved prompt "${data.name}".`);
  } catch (err) {
    toast(err.message, true);
  }
});

// Delete the selected prompt file from disk and clear the text box.
$("deletePromptBtn").addEventListener("click", async () => {
  const name = $("promptSelect").value;
  if (!name) return toast("Select a prompt in the dropdown to delete.", true);
  if (!confirm(`Delete the prompt file "${name}.txt" from disk? This cannot be undone.`)) return;
  try {
    await api(`/api/prompts/${encodeURIComponent(name)}`, { method: "DELETE" });
    await loadPromptList();
    $("promptSelect").value = "";
    $("prompt").value = "";
    toast(`Deleted prompt "${name}".`);
  } catch (err) {
    toast(err.message, true);
  }
});

// Selecting a saved prompt clears the text box and loads that file's contents.
$("promptSelect").addEventListener("change", async (e) => {
  const name = e.target.value;
  if (!name) return;
  try {
    const { content } = await api(`/api/prompts/${encodeURIComponent(name)}`);
    $("prompt").value = content;
    toast(`Loaded prompt "${name}".`);
  } catch (err) {
    toast(err.message, true);
  }
});

// --- init ------------------------------------------------------------------
(async function init() {
  try {
    const cfg = await api("/api/config");
    locationInput.value = cfg.defaultLocation;
    ptyAvailable = !!cfg.ptyAvailable;
  } catch {
    locationInput.value = "M:\\MyStuff\\MyAITeams\\";
  }
  await refreshTeams();
  await loadPromptList(); // populate the Prompt dropdown from the Prompts folder
  await restoreSessions(); // reconnect to any terminals still running server-side
})();
