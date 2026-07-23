# Tab Out

**Keep tabs on your tabs.**

Tab Out is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. This fork also organizes your real Chrome tab strip with native tab groups, semantic rules, and manual custom groups that auto grouping will not touch.

Forked from [zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out).

No server. No account. No external API calls. Just a Chrome extension.

---

## This fork adds

- **Auto groups in Chrome itself** not just on the Tab Out page. Tabs are placed into native Chrome tab groups in the tab strip.
- **Semantic tab grouping** for AI, Dev, Docs, Work, Finance, Reading, Social, Video, and Shopping.
- **Manual custom groups** for tabs you want to control yourself. Once a tab is added manually, auto grouping skips it.
- **One-click group controls** to group now, expand all groups, collapse all groups, or open Tab Out in Chrome's side panel.
- **Shared grouping rules** so the Tab Out dashboard and Chrome's native tab groups use the same names.
- **Current tab focus** keeps the page you are looking at visible at the top, moves its group to the front, and centers it in the side panel.
- **Tab-aware actions** focus, close, or save the exact tab you clicked, even when several tabs share the same URL.
- **Local override hooks** for personal homepage, semantic, and custom rules without changing the main extension code.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/link-king/tab-out
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **Native Chrome tab groups** automatically organize tabs in the real Chrome tab strip
- **Semantic grouping** pulls AI, Dev, Docs, Work, Finance, Reading, Social, Video, and Shopping tabs together
- **Manual custom groups** let you put specific tabs where you want them, and auto grouping leaves them alone
- **One-click controls** group tabs now, expand all groups, collapse all groups, or open Tab Out in the side panel
- **Current tab strip** shows the active page and its group, with a shortcut to jump to that group or close only that tab
- **Automatic side-panel refresh** follows tab switches, new tabs, navigations, and closed tabs while the panel is open
- **Shared rules** keep the Tab Out dashboard and Chrome's native tab groups using the same names
- **Personal grouping config** lets you add local homepage, semantic, or custom rules without changing the core extension
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
- **100% local** your data never leaves your machine
- **Pure Chrome extension** no server, no Node.js, no npm, no setup beyond loading the extension

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/link-king/tab-out.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Tab Out.

---

## How it works

```
You open a new tab
  -> Tab Out shows your open tabs grouped by manual, semantic, or domain rules
  -> The active page appears in a Current tab strip at the top
  -> Its group is moved to the front and the matching tab is centered in the side panel
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Chrome's native tab groups get the same names
  -> Manual custom groups stay separate from auto grouping
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
```

Everything runs inside the Chrome extension. No external server, no API calls, no data sent anywhere. Saved tabs, auto-group settings, and manual custom groups are stored in `chrome.storage.local`.

The Current tab view updates from Chrome tab events while the new-tab page or side panel is visible. Actions use Chrome tab IDs when available, so closing or saving one duplicate page does not affect its siblings.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Native grouping | chrome.tabs + chrome.tabGroups |
| Side panel | chrome.sidePanel |
| Storage | chrome.storage.local |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## License

MIT

---

## Credits

Original project: [zarazhangrui/tab-out](https://github.com/zarazhangrui/tab-out), built by [Zara](https://x.com/zarazhangrui). This fork is extended and maintained by [link-king](https://github.com/link-king).
