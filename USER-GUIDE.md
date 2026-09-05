# ACS AI Teams — User Guide

Give a project its own folder, its own team of AI agents, and its own terminal —
then run `claude` in it without leaving the window. This guide covers everything
on the screen, in the order you meet it.

Applies to **version 1.0.11** (Windows and macOS). The app serves on port
**41730** and needs the **`claude`** CLI on your PATH.

> This is the end-user guide. For building, packaging and the developer setup,
> see [README.md](README.md).

**Contents**

1. [Before you start](#before-you-start)
2. [Install & first run](#install--first-run)
3. [Your first team](#your-first-team)
4. [The screen at a glance](#the-screen-at-a-glance)
5. [Working with terminals](#working-with-terminals)
6. [Prompts](#prompts)
7. [Slash commands](#slash-commands)
8. [Resuming a session](#resuming-a-session)
9. [Team members](#team-members)
10. [Deleting a team](#deleting-a-team)
11. [Use it from your phone](#use-it-from-your-phone)
12. [When something goes wrong](#when-something-goes-wrong)
13. [Where your data lives](#where-your-data-lives)

## Before you start

ACS AI Teams is a desktop app that does real work on your machine: it creates and
deletes folders, and it runs the `claude` command-line tool inside terminals
embedded in its own window. Two things have to be true before it is useful.

- **The `claude` CLI is installed and on your PATH.** The installer does not
  bundle it. Open a terminal, type `claude`, and make sure it starts.
- **You have a licence key, or you are inside the trial.** First launch offers a
  **7-day trial**; after that the app asks for a key. Keys look like `ACS1.…` and
  are checked on your own machine — the app never calls home to validate one, so
  it works offline.

While the trial is running, a small badge sits in the bottom-right corner of the
window with the days remaining, a **Buy a license** link, and **I have a key** —
which lets you paste a key in without restarting.

## Install & first run

**Windows.** Run `ACS AI Teams Setup 1.0.11.exe`. It installs for your user
account only, so it needs no administrator rights, and it lets you change the
install folder. If the build is unsigned, SmartScreen will interrupt: choose
**More info** → **Run anyway**.

**macOS.** Open the `.dmg` and drag the app to Applications. If the build is
unsigned, right-click the app and choose **Open** the first time, which gives you
an Open button Gatekeeper otherwise withholds.

**On first launch** the app asks one question: where do you want to keep your AI
Teams? Every team you create becomes a folder there. Pick something you back up —
your Documents folder, a synced drive — rather than a temporary location. You can
change it later from the **Location** field.

The version you are running is printed under the app title in the left panel, so
you can always tell which build is in front of you.

## Your first team

This is the one part of the app that is a sequence. Everything after it is
reference.

1. **Check the Location.** The top-left field shows where teams are stored, and it
   is locked on purpose. To change it, press **Unlock**, then **Browse…** to pick
   a folder — it re-locks itself once you choose, so you cannot edit it by
   accident.

2. **Name the team.** Type a name into **Team Name**. The field doubles as a
   dropdown of the teams already in your Location, so an existing one is a click
   away. **Refresh List** re-reads the folder if you have added a team from
   outside the app.

3. **Name the session.** **Session Name** is required — it names both the terminal
   tab and the Claude session inside it. Name it after the piece of work rather
   than the team (`pricing-page`, `Q3 report`), because a team usually ends up
   with several.

4. **Press Create/Activate Team.** If the team is new, three folders are created
   inside it — `Deliverables`, `Team Register` and `Team Task Data`. If it already
   exists, nothing is overwritten; the app just opens a terminal in it. Either way
   a terminal tab appears with `claude` already running in the team folder. A
   moment after it starts, the app types `/rename` for you so the Claude session
   carries the session name you gave it.

5. **Work in the terminal.** Type into it exactly as you would any terminal. Press
   the same button again with a *different* session name to get a second terminal
   on the same team; press it with the *same* name and the app simply switches you
   back to that tab instead of opening a duplicate.

## The screen at a glance

Two panels. The left one is about the team; the right one is about what you send
it.

### Left panel — the team

| Control | What it does |
| --- | --- |
| **Location** · Unlock · Browse… | The folder that holds all your teams. Locked until you unlock it. |
| **Team Name** · Refresh List | Type a new name, or pick an existing team from the dropdown. |
| **Session Name** | Names this terminal and the Claude session in it. Required. |
| **Create/Activate Team** | Makes the team folders if needed, then opens a terminal in them. |
| **Delete Team** | Removes the team folder and everything in it. Asks first. |
| **Open Claude Desktop** | Launches the separate Claude Desktop app, if it is installed. |

### Right panel — the prompt

| Control | What it does |
| --- | --- |
| **Prompt Category** · Load a saved prompt | Categories are folders of saved prompts; the second dropdown lists what is in the chosen one. |
| **Prompt box** | Type or edit here. The **×** in the corner clears it. |
| **Send Text to Selected Terminal** | Pastes the prompt into the chosen terminal without submitting it. |
| **Save Prompt** · **Delete Prompt File** | Keeps the current text as a reusable prompt, or removes a saved one. |
| **View Team Directory** | Opens the team folder in Explorer or Finder. |
| **View Team Members** | Opens the roster of agent profiles for this team. |
| **Open Terminals** | Chooses which terminal the two send buttons act on. |
| **Slash Command** | Types a `/` command into that terminal for you. |
| **Resume Session** | Re-opens one of this team's past Claude conversations. |

### Two layouts

The link under the studio name switches between the **classic** layout, where
terminals are tabs across the top, and the **vertical** layout, where they stack
as an accordion. Same app, same sessions — pick whichever suits your screen.

## Working with terminals

These are real, long-lived terminals on your machine, not browser tabs pretending
to be terminals. They keep running whether or not you are looking at them.

**Tabs.** Every **Create/Activate** opens another tab, up to **16 at once**. When
one team has several, the tabs number themselves — `ACS-AI`, `ACS-AI (2)`,
`ACS-AI (3)`.

**Hide versus close — the important distinction.**

- **–** on the terminal bar, or <kbd>Esc</kbd>, **hides** the terminal window.
  Everything keeps running, and a floating **▸ Terminals (N)** pill appears to
  bring it back.
- **×** on a tab **ends that session**. That one is gone; the others are
  untouched.

**Detach to an OS window.** The **↗** button on a tab moves that team out into a
native terminal window. Worth knowing: a running `claude` cannot be handed between
processes, so this ends the embedded session and starts a *fresh* one in the new
window. Anything in progress is not carried across.

**What survives what.**

| You do this | What happens to your terminals |
| --- | --- |
| Switch tabs, or hide the window | Nothing. Every session keeps running. |
| Reload the page | Still-running terminals come back as tabs automatically. |
| Quit and restart the app | Tabs return with their transcript replayed. The `claude` inside is a new process, so it has the text but not its previous memory of the conversation. |
| Delete the team | That team's terminals are ended first, so nothing holds the folder open. |

**If terminals will not open.** On a machine where the embedded terminal engine
cannot load, the app falls back to opening `claude` in a separate OS terminal
window instead. You lose the tabs and the transcript replay, but the app still
works.

## Prompts

The right-hand box is a scratchpad for the text you send to a terminal, and a
small library of the prompts you reuse.

- **Save Prompt** stores the current text under a name you give it, in the
  selected category.
- **Prompt Category** is simply a folder of prompts. Choose `(Top level)` for
  ungrouped ones, or create a new category by name.
- **Delete Prompt File** removes the saved prompt currently loaded.

**Sending text to a terminal.** Pick the terminal in **Open Terminals**, then
press **Send Text to Selected Terminal**. The text is pasted in and the terminal
comes to the front — but it is **not submitted**. You read it over and press
<kbd>Enter</kbd> yourself. Long prompts are pasted in one piece rather than typed,
so nothing is truncated on the way in.

Your saved prompts live outside the installed program, so app updates never
overwrite them.

## Slash commands

The **Slash Command** dropdown is a menu of Claude Code's own commands, grouped by
what they do — session and context (`/clear`, `/compact`, `/resume`), model and
mode (`/model`, `/plan`), review and workflows (`/code-review`,
`/security-review`), and so on.

Choosing one **types it into the selected terminal without running it**, so you
can add arguments first and press <kbd>Enter</kbd> when you are ready. Pick the
terminal in **Open Terminals** first, or the app will tell you to.

## Resuming a session

**Resume Session** lists this team's past Claude conversations, newest first, by
their titles. Pick one and the app opens a terminal that resumes that conversation
rather than starting a blank one — the difference between "carry on where we left
off" and "start again".

The list is per team, so changing the team name changes what it offers.

## Team members

**View Team Members** opens a carousel of the agents on the team. Each card is
built from a Markdown profile in the team's `Team Register` folder (a `Team`
folder is used instead if one exists) — one file per member, giving their name and
role.

Photos come from a `Team Gallery` folder inside the team, matched to members by
file name. Members without a photo are given one from the pool of unassigned
headshots that ships with the app. Housekeeping files such as `roster` and
`hiring-log` are skipped rather than shown as people. Press <kbd>Esc</kbd> to
close.

## Deleting a team

> **Permanent.** **Delete Team** removes the team's folder and everything inside
> it — deliverables, register, task data, the lot — recursively, and without a
> trip to the Recycle Bin or Trash. Any terminals for that team are ended first so
> nothing holds the folder open. The app asks you to confirm; that confirmation is
> the only safety net there is.

If you only want to stop working on a team, close its terminals and leave the
folder alone.

## Use it from your phone

The app can serve its interface to another device on your private network, so you
can watch and steer a session from a phone while the work itself runs on your PC.

> **Read this first.** **Anyone who opens that page gets an interactive terminal
> on your PC.** Use it only over [Tailscale](https://tailscale.com) — a private
> encrypted network of just your own devices — and never on open Wi-Fi, a shared
> office network, or the public internet. Buttons such as **Browse…** and **View
> Team Directory** act on the host PC, not on the phone.

1. **Connect both devices to your tailnet.** Install Tailscale on the PC and the
   phone, and sign both into the same account.
2. **Start the app in network mode.** Run `start-tailscale-app.cmd`. It finds your
   Tailscale address, binds the app to that address only — never to your ordinary
   network — and prints the URL to open. The app shows it as a **Network access**
   badge in the top-left corner.
3. **Allow it through the firewall, once.** On Windows, the first time only, run
   the firewall rule from the [README](README.md#access-from-your-phone-tailscale)
   in an administrator PowerShell. It admits tailnet addresses only.
4. **Open the URL on the phone.** Same screen, same sessions, same teams — just a
   smaller window onto them.

**New in 1.0.11.** If a server is already running when you open the desktop app,
the app now **connects to it** instead of taking the port from it, and says so in
a badge. Your phone keeps its session, and closing the app window leaves that
server running. Earlier versions stopped the running server, which dropped the
phone mid-session.

## When something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| "Port 41730 is already in use by another program" | Something that is not ACS AI Teams is holding the port. | Close that program, or start the app with the `PORT` environment variable set to a different number. |
| A terminal opens, but `claude` is not found | The CLI is not installed, or not on this account's PATH. | Install it, then check that typing `claude` in an ordinary terminal works before retrying. |
| Terminals open in separate OS windows | The embedded terminal engine could not load on this machine. | Nothing is broken — this is the fallback. Reinstalling the app is the fix worth trying. |
| "Select an open terminal first" | Send Text and Slash Command both need a target. | Choose one in **Open Terminals**, then press the button again. |
| The team dropdown is missing a folder you just added | The list is read when the app asks for it, not continuously. | Press **Refresh List**. |
| Tabs come back with old text after a restart | Working as designed: the transcript is replayed into a new session. | Use **Resume Session** when you need Claude to remember the conversation, not just show it. |
| The phone page will not load | Usually the firewall rule, or the app was not started in network mode. | Check that the **Network access** badge is showing, then add the firewall rule. |

## Where your data lives

Two separate places, which is what makes the app safe to reinstall.

| What | Where |
| --- | --- |
| Your teams and their work | The **Location** folder you chose on first run — one folder per team, each holding `Deliverables`, `Team Register` and `Team Task Data`. |
| Sessions, scrollback, saved prompts, your licence | Windows: `%APPDATA%\ACS AI Teams`<br>macOS: `~/Library/Application Support/ACS AI Teams` |

Neither lives inside the installed program, so updating or reinstalling leaves
your teams, prompts and licence exactly where they are. Uninstalling does not
remove your teams either — delete that folder yourself if you truly want them
gone.
