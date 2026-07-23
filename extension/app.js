/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

const GROUPING_MESSAGES = {
  GET_GROUPING_STATE: 'TAB_OUT_GET_GROUPING_STATE',
  SET_AUTO_GROUPING: 'TAB_OUT_SET_AUTO_GROUPING',
  GROUP_TABS_NOW: 'TAB_OUT_GROUP_TABS_NOW',
  APPLY_MANUAL_GROUPING: 'TAB_OUT_APPLY_MANUAL_GROUPING',
  SET_GROUPS_COLLAPSED: 'TAB_OUT_SET_GROUPS_COLLAPSED',
  OPEN_SIDE_PANEL: 'TAB_OUT_OPEN_SIDE_PANEL',
};

function sendRuntimeMessage(message) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: 'No response from extension background.' });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message || String(err) });
    }
  });
}

async function getGroupingState() {
  const response = await sendRuntimeMessage({ type: GROUPING_MESSAGES.GET_GROUPING_STATE });
  return response && response.ok ? response.state : null;
}

async function getCurrentWindowId() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    return currentWindow && currentWindow.id;
  } catch {
    return null;
  }
}

async function renderGroupingControls() {
  const toggle = document.getElementById('autoGroupToggle');
  const label = document.getElementById('autoGroupLabel');
  if (!toggle || !label) return;

  const state = await getGroupingState();
  if (!state) {
    toggle.disabled = true;
    label.textContent = 'Groups unavailable';
    return;
  }

  toggle.disabled = false;
  toggle.checked = state.settings.enabled === true;
  label.textContent = state.settings.enabled ? 'Auto groups on' : 'Auto groups off';
  label.title = `${state.stats.groupedTabs} grouped, ${state.stats.ungroupedTabs} ungrouped`;
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      groupId:  t.groupId,
      pinned:   t.pinned,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function closeTabsByIds(tabIds) {
  const ids = [...new Set((tabIds || []).map(id => Number(id)).filter(Number.isInteger))];
  if (ids.length > 0) await chrome.tabs.remove(ids);
  await fetchOpenTabs();
}

function tabIdFromElement(el) {
  const rawId = el && (el.dataset.tabId || el.closest('.page-chip')?.dataset.tabId);
  if (rawId === undefined || rawId === null || rawId === '') return null;
  const tabId = Number(rawId);
  return Number.isInteger(tabId) ? tabId : null;
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

async function focusTabById(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !Number.isInteger(tab.id)) return false;
    await chrome.tabs.update(tab.id, { active: true });
    if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}

async function getManualGroupsState() {
  const result = await chrome.storage.local.get(TAB_OUT_RULES.MANUAL_GROUPS_STORAGE_KEY);
  return TAB_OUT_RULES.normalizeManualGroupsState(result[TAB_OUT_RULES.MANUAL_GROUPS_STORAGE_KEY]);
}

async function setManualGroupsState(nextState) {
  const normalized = TAB_OUT_RULES.normalizeManualGroupsState(nextState);
  await chrome.storage.local.set({ [TAB_OUT_RULES.MANUAL_GROUPS_STORAGE_KEY]: normalized });
  manualGroupsState = normalized;
  return normalized;
}

function makeManualGroupId(name) {
  const slug = String(name || 'group')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'group';
  return `${slug}-${Date.now().toString(36)}`;
}

async function createManualGroup(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const state = await getManualGroupsState();
  const now = new Date().toISOString();
  const group = {
    id: makeManualGroupId(trimmed),
    name: trimmed.slice(0, 40),
    color: TAB_OUT_RULES.colorFromString(trimmed),
    createdAt: now,
    updatedAt: now,
  };
  state.groups.push(group);
  await setManualGroupsState(state);
  return group;
}

async function assignTabToManualGroup(url, groupId) {
  if (!url || !groupId) return null;

  const state = await getManualGroupsState();
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return null;
  state.assignments[url] = groupId;
  group.updatedAt = new Date().toISOString();
  await setManualGroupsState(state);
  return group;
}

async function removeTabFromManualGroup(url) {
  if (!url) return;

  const state = await getManualGroupsState();
  delete state.assignments[url];
  await setManualGroupsState(state);
}

async function deleteManualGroup(groupId) {
  if (!groupId) return false;

  const state = await getManualGroupsState();
  const before = state.groups.length;
  const affectedUrls = Object.entries(state.assignments)
    .filter(([, assignedGroupId]) => assignedGroupId === groupId)
    .map(([url]) => url);
  state.groups = state.groups.filter(group => group.id !== groupId);
  for (const [url, assignedGroupId] of Object.entries(state.assignments)) {
    if (assignedGroupId === groupId) delete state.assignments[url];
  }
  await setManualGroupsState(state);
  return {
    deleted: state.groups.length !== before,
    affectedUrls,
  };
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];
let manualGroupsState = { groups: [], assignments: {} };
let currentActiveTab = null;
let dashboardRefreshTimer = null;
let lastCenteredCurrentTabKey = '';
let liveDashboardRefreshSetup = false;


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

async function getCurrentActiveRealTab() {
  try {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const current = activeTabs.find(tab => TAB_OUT_RULES.isRealTabUrl(tab.url));
    if (current) return current;
  } catch {}

  return openTabs.find(tab => tab.active && TAB_OUT_RULES.isRealTabUrl(tab.url)) || null;
}

function isSameTab(tab, otherTab) {
  if (!tab || !otherTab) return false;
  if (Number.isInteger(tab.id) && Number.isInteger(otherTab.id)) return tab.id === otherTab.id;
  return tab.url && otherTab.url && tab.url === otherTab.url && tab.windowId === otherTab.windowId;
}

function stableDomainId(domain) {
  return 'domain-' + String(domain || '').replace(/[^a-z0-9]/g, '-');
}

function getGroupLabel(group) {
  if (!group) return '';
  return group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
}

function getHostnameForTab(tab) {
  try { return new URL(tab.url).hostname; } catch { return ''; }
}

function getTabLabel(tab) {
  const hostname = getHostnameForTab(tab);
  return cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), hostname) || hostname || tab.url || 'Current tab';
}

function findGroupForTab(groups, tab) {
  if (!tab) return null;
  return (groups || []).find(group => (group.tabs || []).some(groupTab => isSameTab(groupTab, tab))) || null;
}

function prioritizeCurrentTabGroup(groups, tab) {
  if (!tab) return groups;
  const index = (groups || []).findIndex(group => (group.tabs || []).some(groupTab => isSameTab(groupTab, tab)));
  if (index <= 0) return groups;
  const ordered = groups.slice();
  const [currentGroup] = ordered.splice(index, 1);
  ordered.unshift(currentGroup);
  return ordered;
}

function findDomainCard(domainId) {
  return Array.from(document.querySelectorAll('.mission-card[data-domain-id]')).find(card => card.dataset.domainId === domainId) || null;
}

function currentTabCenterKey(tab, group) {
  if (!tab) return '';
  const tabKey = Number.isInteger(tab.id) ? tab.id : `${tab.windowId || ''}:${tab.url || ''}`;
  return `${tabKey}:${group ? group.domain || '' : 'nogroup'}`;
}

function renderCurrentTabStrip(tab, group) {
  const strip = document.getElementById('currentTabStrip');
  if (!strip) return;

  if (!tab) {
    strip.innerHTML = `
      <div class="current-tab-main">
        <div class="current-tab-copy">
          <div class="current-tab-label">Current tab</div>
          <div class="current-tab-title">Open a webpage to show it here</div>
        </div>
        <div class="current-tab-group">No active webpage detected</div>
      </div>`;
    strip.style.display = 'flex';
    return;
  }

  const label = getTabLabel(tab);
  const groupLabel = group ? getGroupLabel(group) : 'Not grouped yet';
  const hostname = getHostnameForTab(tab);
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=16` : '';
  const tabId = Number.isInteger(tab.id) ? String(tab.id) : '';
  const domainId = group ? stableDomainId(group.domain) : '';

  strip.innerHTML = `
    <div class="current-tab-main">
      ${faviconUrl ? `<img class="current-tab-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="current-tab-copy">
        <div class="current-tab-label">Current tab</div>
        <div class="current-tab-title" title="${escapeAttr(label)}">${escapeHtml(label)}</div>
      </div>
      <div class="current-tab-group" title="${escapeAttr(groupLabel)}">Group: ${escapeHtml(groupLabel)}</div>
    </div>
    <div class="current-tab-actions">
      ${group ? `<button class="action-btn" data-action="show-current-group" data-domain-id="${escapeAttr(domainId)}">Show group</button>` : ''}
      <button class="action-btn close-tabs" data-action="close-single-tab" data-tab-id="${escapeAttr(tabId)}" data-tab-url="${escapeAttr(tab.url || '')}">
        ${ICONS.close}
        Close
      </button>
    </div>`;
  strip.style.display = 'flex';
}

function centerCurrentTabInSidePanel(tab, group) {
  const centerKey = currentTabCenterKey(tab, group);
  if (!centerKey || centerKey === lastCenteredCurrentTabKey) return;
  lastCenteredCurrentTabKey = centerKey;

  setTimeout(() => {
    const card = group ? findDomainCard(stableDomainId(group.domain)) : null;
    if (!card) return;

    const tabId = Number.isInteger(tab && tab.id) ? String(tab.id) : '';
    const currentChip = tabId
      ? Array.from(card.querySelectorAll('.page-chip[data-tab-id]')).find(chip => chip.dataset.tabId === tabId)
      : null;
    const target = currentChip || card;

    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    card.classList.add('current-group-pulse');
    if (currentChip) currentChip.classList.add('chip-current-pulse');

    setTimeout(() => {
      card.classList.remove('current-group-pulse');
      if (currentChip) currentChip.classList.remove('chip-current-pulse');
    }, 900);
  }, 120);
}

function setupLiveDashboardRefresh() {
  if (liveDashboardRefreshSetup) return;
  liveDashboardRefreshSetup = true;

  const schedule = (delay = 250) => {
    if (dashboardRefreshTimer) clearTimeout(dashboardRefreshTimer);
    dashboardRefreshTimer = setTimeout(() => {
      dashboardRefreshTimer = null;
      if (document.visibilityState !== 'hidden') renderDashboard();
    }, delay);
  };

  try {
    chrome.tabs.onActivated.addListener(() => schedule(80));
    chrome.tabs.onCreated.addListener(() => schedule(250));
    chrome.tabs.onRemoved.addListener(() => schedule(120));
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') schedule(250);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedule(0);
    });
  } catch {}
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function getManualGroupCounts(state = manualGroupsState) {
  const counts = {};
  for (const group of state.groups || []) counts[group.id] = 0;
  for (const groupId of Object.values(state.assignments || {})) {
    if (typeof counts[groupId] === 'number') counts[groupId] += 1;
  }
  return counts;
}

function renderCustomGroupsPanel() {
  const panel = document.getElementById('customGroupsPanel');
  if (!panel) return;

  const groups = manualGroupsState.groups || [];
  const counts = getManualGroupCounts();
  const groupRows = groups.length
    ? `<div class="custom-group-list">
        ${groups.map(group => `
          <div class="custom-group-pill">
            <span class="custom-group-dot color-${group.color || 'grey'}"></span>
            <span class="custom-group-name">${escapeHtml(group.name)}</span>
            <span class="custom-group-count">${counts[group.id] || 0}</span>
            <button class="custom-group-delete" data-action="delete-manual-group" data-manual-group-id="${group.id}" title="Delete custom group">${ICONS.close}</button>
          </div>`).join('')}
      </div>`
    : '';

  panel.innerHTML = `
    <div class="custom-group-create">
      <input id="manualGroupNameInput" class="custom-group-input" type="text" maxlength="40" placeholder="New custom group">
      <button class="action-btn" data-action="create-manual-group">${ICONS.tabs} Add group</button>
    </div>
    ${groupRows}`;
}

function closeManualGroupMenus() {
  document.querySelectorAll('.manual-group-menu').forEach(menu => menu.remove());
}

function renderManualGroupMenu(anchor, tabUrl, tabTitle) {
  closeManualGroupMenus();

  const menu = document.createElement('div');
  menu.className = 'manual-group-menu';

  const safeUrl = (tabUrl || '').replace(/"/g, '&quot;');
  const safeTitle = (tabTitle || tabUrl || '').replace(/"/g, '&quot;');
  const groups = manualGroupsState.groups || [];
  const groupButtons = groups.map(group => `
    <button class="manual-group-menu-item" data-action="assign-manual-group" data-tab-url="${safeUrl}" data-manual-group-id="${group.id}">
      <span class="custom-group-dot color-${group.color || 'grey'}"></span>
      <span>${escapeHtml(group.name)}</span>
    </button>`).join('');

  menu.innerHTML = `
    <div class="manual-group-menu-title">Custom group</div>
    ${groupButtons || '<div class="manual-group-empty">Create a group first</div>'}
    <div class="manual-group-menu-create">
      <input class="manual-group-menu-input" type="text" maxlength="40" placeholder="New group">
      <button class="manual-group-menu-add" data-action="create-and-assign-manual-group" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}">${ICONS.tabs}</button>
    </div>`;

  anchor.closest('.page-chip').appendChild(menu);
  const input = menu.querySelector('.manual-group-menu-input');
  if (input) input.focus();
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const safeTabId = Number.isInteger(tab.id) ? String(tab.id) : '';
    const manualGroupId = TAB_OUT_RULES.getManualGroupIdForUrl(tab.url, manualGroupsState);
    const manualAction = manualGroupId
      ? `<button class="chip-action chip-manual" data-action="remove-from-manual-group" data-tab-url="${safeUrl}" title="Remove from custom group">${ICONS.close}</button>`
      : `<button class="chip-action chip-manual" data-action="open-manual-group-menu" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Add to custom group">${ICONS.tabs}</button>`;
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        ${manualAction}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = stableDomainId(group.domain);
  const hasCurrentTab = currentActiveTab ? tabs.some(tab => isSameTab(tab, currentActiveTab)) : false;

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Map();
  const uniqueTabs = [];
  for (const tab of tabs) {
    const key = tab.url || `tab:${tab.id}`;
    if (!seen.has(key)) {
      seen.set(key, uniqueTabs.length);
      uniqueTabs.push(tab);
    } else if (isSameTab(tab, currentActiveTab)) {
      uniqueTabs[seen.get(key)] = tab;
    }
  }

  const currentUniqueIndex = uniqueTabs.findIndex(tab => isSameTab(tab, currentActiveTab));
  if (currentUniqueIndex > 0) {
    const [currentTab] = uniqueTabs.splice(currentUniqueIndex, 1);
    uniqueTabs.unshift(currentTab);
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    const titleHostname = group.isSemantic || group.isCustom || group.isManual || isLanding ? '' : group.domain;
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), titleHostname);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const isCurrent = isSameTab(tab, currentActiveTab);
    const chipClass = `${count > 1 ? ' chip-has-dupes' : ''}${isCurrent ? ' chip-is-current' : ''}`;
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const safeTabId = Number.isInteger(tab.id) ? String(tab.id) : '';
    const manualGroupId = TAB_OUT_RULES.getManualGroupIdForUrl(tab.url, manualGroupsState);
    const manualAction = manualGroupId
      ? `<button class="chip-action chip-manual" data-action="remove-from-manual-group" data-tab-url="${safeUrl}" title="Remove from custom group">${ICONS.close}</button>`
      : `<button class="chip-action chip-manual" data-action="open-manual-group-menu" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Add to custom group">${ICONS.tabs}</button>`;
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    const currentBadge = isCurrent ? `<span class="chip-current-badge">Current</span>` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${currentBadge}${dupeTag}
      <div class="chip-actions">
        ${manualAction}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasCurrentTab ? 'has-active-bar current-group-card' : hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();
  await renderGroupingControls();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  currentActiveTab = await getCurrentActiveRealTab();
  manualGroupsState = await getManualGroupsState();
  renderCustomGroupsPanel();

  // --- Manual groups are explicit. Auto grouping only handles the remainder. ---
  const manualGroups = TAB_OUT_RULES.getManualDashboardGroups(realTabs, manualGroupsState);
  const autoGroupTabs = realTabs.filter(tab => !TAB_OUT_RULES.isManualGroupedTab(tab, manualGroupsState));
  const autoGroups = TAB_OUT_RULES.getDashboardGroups(autoGroupTabs, {
    landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : [],
    customGroups: typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [],
    semanticGroups: typeof LOCAL_SEMANTIC_GROUPS !== 'undefined' ? LOCAL_SEMANTIC_GROUPS : [],
  });
  domainGroups = prioritizeCurrentTabGroup(manualGroups.concat(autoGroups), currentActiveTab);
  const currentGroup = findGroupForTab(domainGroups, currentActiveTab);
  renderCurrentTabStrip(currentActiveTab, currentGroup);

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
    centerCurrentTabInSidePanel(currentActiveTab, currentGroup);
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) {
    if (!e.target.closest('.manual-group-menu')) closeManualGroupMenus();
    return;
  }

  const action = actionEl.dataset.action;

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  // ---- Toggle automatic native Chrome tab grouping ----
  if (action === 'toggle-auto-group') {
    e.stopPropagation();
    const enabled = actionEl.checked === true;
    const response = await sendRuntimeMessage({
      type: GROUPING_MESSAGES.SET_AUTO_GROUPING,
      enabled,
    });

    if (!response || !response.ok) {
      actionEl.checked = !enabled;
      showToast(response && response.error ? response.error : 'Could not update auto groups');
      await renderGroupingControls();
      return;
    }

    const grouped = response.result ? response.result.groupedTabs : 0;
    showToast(enabled ? `Auto groups on${grouped ? ` — grouped ${grouped}` : ''}` : 'Auto groups off');
    await renderDashboard();
    return;
  }

  // ---- Apply grouping rules to current ungrouped tabs ----
  if (action === 'group-tabs-now') {
    const response = await sendRuntimeMessage({ type: GROUPING_MESSAGES.GROUP_TABS_NOW });
    if (!response || !response.ok) {
      showToast(response && response.error ? response.error : 'Could not group tabs');
      return;
    }

    const grouped = response.result.groupedTabs;
    const groups = response.result.groupsTouched;
    showToast(grouped > 0
      ? `Grouped ${grouped} tab${grouped !== 1 ? 's' : ''} into ${groups} group${groups !== 1 ? 's' : ''}`
      : 'No ungrouped tabs to organize');
    await renderDashboard();
    return;
  }

  // ---- Expand or collapse all native Chrome tab groups in this window ----
  if (action === 'expand-tab-groups' || action === 'collapse-tab-groups') {
    const collapse = action === 'collapse-tab-groups';
    const response = await sendRuntimeMessage({
      type: GROUPING_MESSAGES.SET_GROUPS_COLLAPSED,
      collapsed: collapse,
      windowId: await getCurrentWindowId(),
    });

    if (!response || !response.ok) {
      showToast(response && response.error ? response.error : 'Could not update tab groups');
      return;
    }

    const total = response.result.totalGroups;
    const touched = response.result.groupsTouched;
    if (total === 0) {
      showToast('No tab groups in this window');
    } else {
      showToast(`${collapse ? 'Collapsed' : 'Expanded'} ${touched} of ${total} group${total !== 1 ? 's' : ''}`);
    }
    return;
  }

  // ---- Open Chrome side panel ----
  if (action === 'open-side-panel') {
    const response = await sendRuntimeMessage({
      type: GROUPING_MESSAGES.OPEN_SIDE_PANEL,
      windowId: await getCurrentWindowId(),
    });
    showToast(response && response.ok ? 'Side panel opened' : 'Use the toolbar icon to open Panel');
    return;
  }

  // ---- Create a manual custom group ----
  if (action === 'create-manual-group') {
    e.stopPropagation();
    const input = document.getElementById('manualGroupNameInput');
    const name = input && input.value.trim();
    if (!name) {
      showToast('Name the custom group first');
      return;
    }

    const group = await createManualGroup(name);
    if (input) input.value = '';
    renderCustomGroupsPanel();
    showToast(group ? `Created ${group.name}` : 'Could not create group');
    return;
  }

  // ---- Delete a manual custom group ----
  if (action === 'delete-manual-group') {
    e.stopPropagation();
    const groupId = actionEl.dataset.manualGroupId;
    const result = await deleteManualGroup(groupId);
    if (result.deleted) {
      for (const url of result.affectedUrls) {
        await sendRuntimeMessage({ type: GROUPING_MESSAGES.APPLY_MANUAL_GROUPING, url });
      }
      showToast('Custom group deleted');
      await renderDashboard();
    }
    return;
  }

  // ---- Open the per-tab manual group menu ----
  if (action === 'open-manual-group-menu') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;
    renderManualGroupMenu(actionEl, tabUrl, tabTitle);
    return;
  }

  // ---- Assign a tab to a manual custom group ----
  if (action === 'assign-manual-group') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    const groupId = actionEl.dataset.manualGroupId;
    const group = await assignTabToManualGroup(tabUrl, groupId);
    closeManualGroupMenus();
    if (group) {
      await sendRuntimeMessage({ type: GROUPING_MESSAGES.APPLY_MANUAL_GROUPING, url: tabUrl });
      showToast(`Added to ${group.name}`);
      await renderDashboard();
    }
    return;
  }

  // ---- Create a manual custom group and assign the tab to it ----
  if (action === 'create-and-assign-manual-group') {
    e.stopPropagation();
    const menu = actionEl.closest('.manual-group-menu');
    const input = menu && menu.querySelector('.manual-group-menu-input');
    const name = input && input.value.trim();
    const tabUrl = actionEl.dataset.tabUrl;
    if (!name || !tabUrl) {
      showToast('Name the custom group first');
      return;
    }

    const group = await createManualGroup(name);
    if (group) await assignTabToManualGroup(tabUrl, group.id);
    if (group) await sendRuntimeMessage({ type: GROUPING_MESSAGES.APPLY_MANUAL_GROUPING, url: tabUrl });
    closeManualGroupMenus();
    showToast(group ? `Added to ${group.name}` : 'Could not create group');
    await renderDashboard();
    return;
  }

  // ---- Remove a tab from manual custom grouping ----
  if (action === 'remove-from-manual-group') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    await removeTabFromManualGroup(tabUrl);
    await sendRuntimeMessage({ type: GROUPING_MESSAGES.APPLY_MANUAL_GROUPING, url: tabUrl });
    showToast('Removed from custom group');
    await renderDashboard();
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Jump to the group that contains the current tab ----
  if (action === 'show-current-group') {
    e.stopPropagation();
    const targetCard = findDomainCard(actionEl.dataset.domainId);
    if (!targetCard) return;
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetCard.classList.add('current-group-pulse');
    setTimeout(() => targetCard.classList.remove('current-group-pulse'), 900);
    return;
  }

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabId = tabIdFromElement(actionEl);
    if (tabId !== null && await focusTabById(tabId)) return;
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    const tabId = tabIdFromElement(actionEl);
    if (tabId === null && !tabUrl) return;

    // Close the tab in Chrome directly
    if (tabId !== null) {
      await closeTabsByIds([tabId]);
    } else {
      const allTabs = await chrome.tabs.query({});
      const match = allTabs.find(t => t.url === tabUrl);
      if (match) await closeTabsByIds([match.id]);
    }

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    const tabId = tabIdFromElement(actionEl);
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    if (tabId !== null) {
      await closeTabsByIds([tabId]);
    } else {
      const allTabs = await chrome.tabs.query({});
      const match = allTabs.find(t => t.url === tabUrl);
      if (match) await closeTabsByIds([match.id]);
    }

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => stableDomainId(g.domain) === domainId);
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

document.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;

  const groupInput = e.target.closest('#manualGroupNameInput');
  if (groupInput) {
    const group = await createManualGroup(groupInput.value);
    groupInput.value = '';
    renderCustomGroupsPanel();
    showToast(group ? `Created ${group.name}` : 'Name the custom group first');
    return;
  }

  const menuInput = e.target.closest('.manual-group-menu-input');
  if (menuInput) {
    const menu = menuInput.closest('.manual-group-menu');
    const addButton = menu && menu.querySelector('[data-action="create-and-assign-manual-group"]');
    if (addButton) addButton.click();
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
setupLiveDashboardRefresh();
renderDashboard();
