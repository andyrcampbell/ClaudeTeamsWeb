# ACS AI Teams — Web Edition

A web rewrite of the `ClaudeTeams` VB.NET WinForms utility. Same purpose and
behaviour, delivered as a small local website instead of a desktop `.exe`.

Because the app does real work on your machine — creating/deleting team folders
and running `claude` — it runs as a **local Node server** bound to `127.0.0.1`.
The browser is just the UI; the server does the filesystem and process work the
WinForms app used to do.

`claude` runs **inside embedded terminals on the web page** (xterm.js panels
backed by real pseudo-terminals), so you never leave the browser. You can keep
**several team terminals open at once** as tabs, switch between them, and
**re-attach (reconnect)** to a still-running session after a page reload —
scrollback is replayed so you pick up where you left off. If the terminal
backend can't load on a given machine, the app automatically falls back to
opening `claude` in a separate OS terminal window instead.

### Terminal tabs, reconnect & persistence

- **Multiple sessions:** every Create/Activate opens a new terminal tab — so a
  single team can have several terminals running side by side. When a team has
  more than one, the tabs are numbered (`ACS-AI`, `ACS-AI (2)`, `ACS-AI (3)`).
  Per-tab actions (detach ↗, close ×) act on that specific terminal.
- **Persistent sessions:** each terminal is a long-lived pty on the server,
  independent of the browser socket. Switching tabs, hiding the window, or
  reloading the page does **not** kill it.
- **Hide vs close:** the **–** button hides the terminal window but keeps every
  session running (a floating **▸ Terminals (N)** pill brings it back). A tab's
  **×** ends that one session. `Esc` hides the window.
- **Detach to an OS window (↗):** each tab has a **↗** button that pops the team
  out into a native OS terminal window. Because a running `claude` can't be moved
  between processes, this ends the embedded session and starts a *fresh* `claude`
  in the native window.
- **Reconnect after reload:** refresh the page and any still-running terminals
  are restored as tabs automatically.
- **Survives a server restart:** session metadata and scrollback are saved to
  `data/` on disk. If you stop and restart the server, your open terminals come
  back as tabs when you reload the page — with the previous transcript shown as
  history. (The restored `claude` is a *new* process; its in-memory conversation
  from before the restart is gone, but the text transcript is replayed.)
- Up to 16 concurrent sessions.

## Setting up from a fresh clone

Moving to a new machine (or cloning from GitHub) takes three steps:

```bash
git clone https://github.com/andyrcampbell/ClaudeTeamsWeb.git
cd ClaudeTeamsWeb
npm install
```

Then launch it:

- **Windows:** double-click `start.cmd` (or run it in a terminal)
- **macOS / Linux:** `./start.sh`

…and open <http://127.0.0.1:4173>.

Notes:

- `node_modules/` is **not** committed — `npm install` rebuilds it, fetching the
  correct per-platform `node-pty` binary for that machine.
- `data/` (persisted sessions, scrollback, and the saved Location) is **not**
  committed either; it regenerates on first run. On the new machine, click
  **Unlock → Browse…** to point the app at wherever you want teams stored.
- Your team folders (`Deliverables` / `Team Register` / `Team Task Data`) live
  under the **Location**, not inside this repo — copy that folder separately if
  you want your existing teams.

## Requirements

- [Node.js](https://nodejs.org) (any recent LTS)
- `claude` CLI on your PATH (same as the original app relied on)
- Windows, **macOS**, or Linux (see platform notes below)

`npm install` pulls in `node-pty` (the embedded-terminal backend). It ships
prebuilt binaries for common Node versions, so no compiler is normally needed;
if a prebuilt isn't available it may require build tools, and if it can't be
loaded the app falls back to external terminal windows.

## Run

Windows (PowerShell):

```powershell
cd M:\MyStuff\MyAI\ClaudeTeamsWeb
npm install      # first time only
npm start
```

macOS / Linux (Terminal):

```bash
cd /path/to/ClaudeTeamsWeb
npm install      # first time only
npm start
```

Then open <http://127.0.0.1:4173> in your browser.

To use a different port: `PORT=8080 npm start` (macOS/Linux) or
`set PORT=8080 && npm start` (Windows).

### One-click launcher (stop-then-start)

Because it's easy to leave an old instance running on the port, there are
launchers that stop any running instance first, then start fresh:

- **Windows:** double-click **`start.cmd`** (or run it from a terminal).
- **macOS / Linux:** run **`./start.sh`** (`chmod +x start.sh` once).
- **Any platform:** `npm run restart` — frees the port, then starts.
  `npm run stop` just frees the port.

## Platform behaviour

The app is cross-platform; the OS-specific bits are handled automatically:

| Action                | Windows              | macOS                          | Linux                              |
| --------------------- | -------------------- | ------------------------------ | ---------------------------------- |
| Default location      | `M:\MyStuff\MyAITeams\` | `~/MyAITeams`                | `~/MyAITeams`                      |
| `claude` shell (embedded terminal) | PowerShell   | `$SHELL` (zsh/bash)            | `$SHELL` (bash)                    |
| `claude` fallback window | new PowerShell window | new Terminal.app (AppleScript) | first available terminal emulator |
| View Team Directory   | `explorer`           | `open` (Finder)                | `xdg-open`                         |

On macOS you can change the default location at any time by unlocking the
Location field and typing a different folder path.

## What maps to what

| WinForms control            | Web equivalent                                             |
| --------------------------- | ---------------------------------------------------------- |
| Location textbox + Lock/Unlock | Location field; **Lock/Unlock** toggles read-only        |
| Team Name combo + Refresh   | Team name input with a dropdown of existing folders        |
| Create/Activate Team        | Creates `Deliverables` / `Team Register` / `Team Task Data` (if new) and opens a `claude` terminal tab; each press opens an additional terminal for the team |
| Delete Team                 | Confirms, then deletes the team folder recursively         |
| Team Set Up Prompt          | Editable prompt textarea (same default "Bob" prompt)       |
| Copy Prompt To Clipboard    | Copies the prompt via the browser clipboard                |
| View Team Directory         | Opens the team folder in Explorer                          |
| **Open Claude Desktop** *(new)* | Launches the Claude Desktop app (see below)            |

### Open Claude Desktop

The red **Open Claude Desktop** button on the main page launches the Claude
Desktop app. It handles both install types:

- **Classic installer build** — launched directly by its executable.
- **Microsoft Store / MSIX build** — found via the Start-menu app list and
  launched through `shell:AppsFolder` (Store apps can't be launched by path).
- **macOS** uses `open -a Claude`; Linux tries `claude-desktop` / `claude://`.

If it isn't installed, you get a toast pointing you to claude.ai/download. The
Store lookup can take a second or two, so the button shows an immediate
"Opening…" toast.

## Access from your phone (Tailscale)

The app can't run *on* a phone (it needs Node + the `claude` CLI + `node-pty`),
but your phone can be a **browser client** to the PC that hosts it — the
terminals run `claude` on the PC and stream to the phone.

> ⚠️ The embedded terminal hands whoever loads the page an interactive
> `claude` / shell **on the host PC**. Never expose it to your LAN or the
> internet unprotected. [Tailscale](https://tailscale.com) (a private, encrypted
> network of just your own devices) is the safe way in.

By default the server binds to `127.0.0.1` (localhost only). To reach it from a
phone over Tailscale:

1. Install the **Tailscale app** on the phone and the PC; sign both into the
   same tailnet.
2. On the PC, run **`start-tailscale.cmd`** (Windows). It auto-detects the PC's
   Tailscale IP, binds **only** to that interface (so it's *never* on your LAN),
   allowlists that origin, and prints the URL.
3. First time only — allow it through the firewall (elevated PowerShell):
   ```powershell
   New-NetFirewallRule -DisplayName "ACS AI Teams (Tailscale)" -Direction Inbound `
     -Protocol TCP -LocalPort 4173 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```
   (`100.64.0.0/10` is Tailscale's address range, so only tailnet devices can connect.)
4. On the phone, open the printed URL, e.g. `http://<your-tailscale-ip>:4173`.

Manual equivalent (any platform): set `HOST` (bind address) and `ALLOWED_ORIGINS`
(comma-separated) env vars, e.g. `HOST=0.0.0.0 ALLOWED_ORIGINS=http://<ip>:4173 npm start`.

Note: buttons that act on the OS — **Browse…**, **View Team Directory**, **Open
Claude Desktop**, **Detach to OS window** — happen on the **host PC**, not the phone.
Anyone on your tailnet who opens the page gets terminal access, so only share the
tailnet with people you trust.

## Notes

- By default the server only listens on `127.0.0.1`, so it is not reachable from
  other machines. It performs local file operations by design — only expose it
  over Tailscale (see above), never an open network.
- The embedded terminal gives whoever loads the page an interactive `claude`
  shell, so the WebSocket only accepts connections from allowed origins
  (localhost, plus any in `ALLOWED_ORIGINS`) to block cross-site hijacking.
- Team names are validated to a single folder segment (no `..`, slashes, or
  illegal characters) to prevent escaping the location directory.
- A tab's **×** ends that `claude` session; **–** / `Esc` just hides the window
  and leaves sessions running. Deleting a team also ends its live terminal so
  the folder isn't locked.
- On Windows, deleting a team fails if a `claude` window still has that folder
  open (the OS locks it) — close that window first, exactly as with the original
  app. macOS/Linux don't lock the directory this way.

## Files

```
ClaudeTeamsWeb/
  server.js            Express backend: file ops, REST API, and the
                       WebSocket <-> node-pty terminal bridge
  package.json         scripts: start | restart | stop
  start.cmd            one-click launcher (Windows)
  start.sh             one-click launcher (macOS / Linux)
  scripts/
    free-port.js       stops whatever is listening on the port
  public/
    index.html         UI (+ tabbed terminal overlay)
    style.css          ACS branding / layout
    app.js             frontend logic + xterm.js terminal client
    assets/
      logo.png         (from RawLogo3.png)
      background.png   (from TwilightHours.png)
  data/                (created at runtime) session registry + scrollback
  node_modules/@xterm  terminal UI, served to the browser at /vendor
```
