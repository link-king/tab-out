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

const TAB_META_STORAGE_KEY = 'tabOutTabMeta';
const APPEARANCE_STORAGE_KEY = 'tabOutAppearanceSettings';
const REVIEW_NOT_VIEWED_DAYS = 7;
const REVIEW_OPEN_DAYS = 14;
const RULE_TYPE_LABELS = {
  landing: 'Home pages',
  custom: 'Site rules',
  semantic: 'Smart topics',
};
const DUNHUANG_BACKGROUNDS = [
  { id: 'shazhou-sand', name: '沙州米', background: '#f3dfbd', card: '#fff8e7', border: '#d6bb84', muted: '#8a7a62', accent: '#b8842b' },
  { id: 'dunhuang-gold', name: '敦煌黄', background: '#eaca72', card: '#fff6d6', border: '#d5a43b', muted: '#88713d', accent: '#b68424' },
  { id: 'mingsha-gold', name: '鸣沙金', background: '#edd596', card: '#fff8df', border: '#d6b45f', muted: '#897347', accent: '#bd8b24' },
  { id: 'sutra-paper', name: '经卷纸', background: '#efe0bf', card: '#fff8e9', border: '#d0b582', muted: '#897864', accent: '#a8773d' },
  { id: 'clay-white', name: '壁画白', background: '#efe7db', card: '#fffaf3', border: '#cfc0aa', muted: '#817568', accent: '#9b7855' },
  { id: 'moon-white', name: '月影白', background: '#e8e4dc', card: '#fbfaf6', border: '#bfb8aa', muted: '#7a766e', accent: '#88806c' },
  { id: 'cloud-white', name: '云母白', background: '#f0eee9', card: '#fffdfa', border: '#c9c4ba', muted: '#77736c', accent: '#9c9385' },
  { id: 'silver-mist', name: '银雾', background: '#e3e5e2', card: '#fbfcfa', border: '#b5bbb3', muted: '#737a73', accent: '#7f8a7f' },
  { id: 'mineral-blue', name: '石青', background: '#dce8e4', card: '#f6fbf8', border: '#9bb6ad', muted: '#6f817c', accent: '#537c78' },
  { id: 'lapis-blue', name: '青金', background: '#dce5ee', card: '#f6fafc', border: '#91a8bd', muted: '#687888', accent: '#435d7a' },
  { id: 'cave-blue', name: '窟蓝', background: '#d4dee9', card: '#f4f8fc', border: '#8fa3ba', muted: '#687786', accent: '#3f5f82' },
  { id: 'ink-water', name: '玄水', background: '#d6d8dc', card: '#f6f7f9', border: '#9298a1', muted: '#686f78', accent: '#3f4754' },
  { id: 'smoke-blue', name: '雾青', background: '#d6e2dc', card: '#f6fbf8', border: '#8fa9a0', muted: '#687d76', accent: '#4f746d' },
  { id: 'peacock-blue', name: '孔雀蓝', background: '#d5e8e7', card: '#f3fbfa', border: '#82b2b0', muted: '#627f7e', accent: '#2f8586' },
  { id: 'glaze-teal', name: '琉璃青', background: '#d3e4df', card: '#f4fbf8', border: '#82ada0', muted: '#627d75', accent: '#2f7d73' },
  { id: 'sky-cyan', name: '瓷青', background: '#dcebe6', card: '#f7fcfa', border: '#9fc5bc', muted: '#6c827d', accent: '#4f968a' },
  { id: 'cinnabar', name: '朱砂', background: '#ebcfc6', card: '#fff4ef', border: '#cf8d79', muted: '#866a63', accent: '#b35a45' },
  { id: 'rouge', name: '胭脂', background: '#edd0d6', card: '#fff6f8', border: '#ce8798', muted: '#806873', accent: '#ad4d69' },
  { id: 'tomato-red', name: '番茄红', background: '#f0ccc0', card: '#fff4ef', border: '#d7876e', muted: '#85665d', accent: '#c4523c' },
  { id: 'coral-red', name: '珊瑚', background: '#efcfc2', card: '#fff5ef', border: '#d28b72', muted: '#84685e', accent: '#bd634a' },
  { id: 'lotus-pink', name: '莲瓣粉', background: '#f1d8d0', card: '#fff8f4', border: '#cf9f94', muted: '#806d68', accent: '#aa6258' },
  { id: 'ochre', name: '赭石', background: '#e5cbb0', card: '#fff5ea', border: '#c38a5d', muted: '#826a55', accent: '#9e5e32' },
  { id: 'burnt-sienna', name: '赤陶', background: '#e0bea0', card: '#fff3e8', border: '#be7d52', muted: '#7d6453', accent: '#995533' },
  { id: 'camel-brown', name: '驼褐', background: '#e1ceb6', card: '#fff6ea', border: '#bd9d75', muted: '#7e6d5a', accent: '#9a6a3c' },
  { id: 'walnut', name: '檀棕', background: '#d8c2ad', card: '#fff4ea', border: '#aa8466', muted: '#766454', accent: '#7d5238' },
  { id: 'mineral-green', name: '石绿', background: '#dde8d5', card: '#f7fbf0', border: '#98b483', muted: '#6f8066', accent: '#5f7f58' },
  { id: 'malachite', name: '铜绿', background: '#d5e5d6', card: '#f4fbf2', border: '#8ab48c', muted: '#687f69', accent: '#4f8352' },
  { id: 'willow-green', name: '柳绿', background: '#e3ead2', card: '#f9fcef', border: '#aebd7d', muted: '#767f62', accent: '#758d3e' },
  { id: 'fluorite-green', name: '萤石绿', background: '#e6ecc8', card: '#fbfdec', border: '#bacb6f', muted: '#7a8358', accent: '#839a2d' },
  { id: 'pine-green', name: '松绿', background: '#d8e2d3', card: '#f6fbf3', border: '#8fa886', muted: '#6b7b66', accent: '#4f7454' },
  { id: 'lotus-mauve', name: '莲紫', background: '#e8d5df', card: '#fff7fa', border: '#c796aa', muted: '#7d6b75', accent: '#9b5b78' },
  { id: 'purple-clay', name: '藤紫', background: '#ded2e2', card: '#fbf6fd', border: '#b495bd', muted: '#756b7c', accent: '#75558a' },
  { id: 'grape-purple', name: '葡萄紫', background: '#e1d4e5', card: '#fbf6fd', border: '#b193bd', muted: '#76697d', accent: '#76528d' },
];

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

async function applyAutoGroupingNow() {
  return sendRuntimeMessage({ type: GROUPING_MESSAGES.GROUP_TABS_NOW });
}

async function renderGroupingControls() {
  const toggle = document.getElementById('autoGroupToggle');
  const label = document.getElementById('autoGroupLabel');
  if (!toggle || !label) return;

  const state = await getGroupingState();
  if (!state) {
    toggle.disabled = true;
    label.textContent = 'Auto groups unavailable';
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
      lastAccessed: t.lastAccessed,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
    await updateTabMetadata(openTabs);
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

function isSafeReviewReason(reason) {
  return reason === 'duplicate' || reason === 'search result';
}

function getSafeReviewTabs(tabs) {
  return (tabs || []).filter(tab => (tab.staleReasons || []).some(isSafeReviewReason));
}

async function closeReviewTabsSafely(tabs) {
  const allTabs = await chrome.tabs.query({});
  const tabIdsToClose = new Set();
  const duplicateUrls = new Set();

  for (const tab of tabs || []) {
    if ((tab.staleReasons || []).includes('duplicate')) duplicateUrls.add(tab.url);
  }

  for (const tab of tabs || []) {
    const safeToClose = (tab.staleReasons || []).includes('search result');
    if (!duplicateUrls.has(tab.url) && safeToClose && typeof tab.id === 'number') {
      tabIdsToClose.add(tab.id);
    }
  }

  for (const url of duplicateUrls) {
    const matching = allTabs.filter(tab => tab.url === url);
    const keep = matching.find(tab => tab.active) || matching[0];
    for (const tab of matching) {
      if (keep && tab.id !== keep.id) tabIdsToClose.add(tab.id);
    }
  }

  await closeTabsByIds([...tabIdsToClose]);
  return tabIdsToClose.size;
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

async function getRuleSettings() {
  const result = await chrome.storage.local.get(TAB_OUT_RULES.RULE_SETTINGS_STORAGE_KEY);
  return TAB_OUT_RULES.normalizeRuleSettings(result[TAB_OUT_RULES.RULE_SETTINGS_STORAGE_KEY]);
}

async function setRuleSettings(nextSettings) {
  const normalized = TAB_OUT_RULES.normalizeRuleSettings(nextSettings);
  await chrome.storage.local.set({ [TAB_OUT_RULES.RULE_SETTINGS_STORAGE_KEY]: normalized });
  ruleSettings = normalized;
  return normalized;
}

function makeLocalId(prefix, name) {
  const slug = String(name || prefix || 'item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || prefix || 'item';
  return `${slug}-${Date.now().toString(36)}`;
}

async function setManualGroupsState(nextState) {
  const normalized = TAB_OUT_RULES.normalizeManualGroupsState(nextState);
  await chrome.storage.local.set({ [TAB_OUT_RULES.MANUAL_GROUPS_STORAGE_KEY]: normalized });
  manualGroupsState = normalized;
  return normalized;
}

function makeManualGroupId(name) {
  return makeLocalId('group', name);
}

function normalizeRuleHostInput(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (parsed.hostname) return parsed.hostname.replace(/^\./, '');
  } catch {}

  return raw
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^\./, '');
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

async function createCustomRule({ groupLabel, hostname, pathPrefix }) {
  const label = String(groupLabel || '').trim();
  const host = normalizeRuleHostInput(hostname);
  const path = String(pathPrefix || '').trim();
  if (!label || !host) return null;

  const settings = await getRuleSettings();
  const now = new Date().toISOString();
  const rule = {
    id: makeLocalId('rule', label),
    groupKey: 'rule:' + makeLocalId('group', label),
    groupLabel: label.slice(0, 40),
    hostnameEndsWith: host.replace(/^\./, ''),
    pathPrefix: path ? (path.startsWith('/') ? path : '/' + path) : undefined,
    color: TAB_OUT_RULES.colorFromString(label),
    sortOrder: settings.customGroups.length,
    createdAt: now,
    updatedAt: now,
  };
  settings.customGroups.push(rule);
  await setRuleSettings(settings);
  return rule;
}

async function deleteCustomRule(ruleId) {
  const settings = await getRuleSettings();
  const before = settings.customGroups.length;
  settings.customGroups = settings.customGroups.filter(rule => rule.id !== ruleId);
  await setRuleSettings(settings);
  return settings.customGroups.length !== before;
}

async function moveRulePriority(type, direction) {
  const settings = await getRuleSettings();
  const order = TAB_OUT_RULES.normalizeRuleSettings(settings).ruleOrder.slice();
  const index = order.indexOf(type);
  const nextIndex = index + direction;
  if (index === -1 || nextIndex < 0 || nextIndex >= order.length) return order;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  settings.ruleOrder = order;
  await setRuleSettings(settings);
  return order;
}

async function getWorkspacesState() {
  const result = await chrome.storage.local.get(TAB_OUT_RULES.WORKSPACES_STORAGE_KEY);
  return TAB_OUT_RULES.normalizeWorkspacesState(result[TAB_OUT_RULES.WORKSPACES_STORAGE_KEY]);
}

async function setWorkspacesState(nextState) {
  const normalized = TAB_OUT_RULES.normalizeWorkspacesState(nextState);
  await chrome.storage.local.set({ [TAB_OUT_RULES.WORKSPACES_STORAGE_KEY]: normalized });
  workspacesState = normalized;
  return normalized;
}

async function saveCurrentWorkspace(name) {
  const label = String(name || '').trim();
  if (!label) return null;

  const realTabs = getRealTabs();
  if (realTabs.length === 0) return null;

  const state = await getWorkspacesState();
  const now = new Date().toISOString();
  const seen = new Set();
  const tabs = realTabs
    .filter(tab => tab.url && !seen.has(tab.url) && !tab.isTabOut && (seen.add(tab.url) || true))
    .map(tab => ({
      url: tab.url,
      title: tab.title || tab.url,
      savedAt: now,
    }));
  if (tabs.length === 0) return null;

  const workspace = {
    id: makeLocalId('workspace', label),
    name: label.slice(0, 48),
    tabs,
    createdAt: now,
    updatedAt: now,
  };
  state.workspaces.unshift(workspace);
  await setWorkspacesState(state);
  return workspace;
}

async function restoreWorkspace(workspaceId) {
  const state = await getWorkspacesState();
  const workspace = state.workspaces.find(item => item.id === workspaceId);
  if (!workspace) return 0;

  const existing = new Set((await chrome.tabs.query({})).map(tab => tab.url));
  const toOpen = workspace.tabs.filter(tab => tab.url && !existing.has(tab.url));
  for (const tab of toOpen) {
    await chrome.tabs.create({ url: tab.url, active: false });
  }
  return toOpen.length;
}

async function deleteWorkspace(workspaceId) {
  const state = await getWorkspacesState();
  const before = state.workspaces.length;
  state.workspaces = state.workspaces.filter(item => item.id !== workspaceId);
  await setWorkspacesState(state);
  return state.workspaces.length !== before;
}

async function getTabMetadata() {
  const result = await chrome.storage.local.get(TAB_META_STORAGE_KEY);
  return result[TAB_META_STORAGE_KEY] && typeof result[TAB_META_STORAGE_KEY] === 'object'
    ? result[TAB_META_STORAGE_KEY]
    : {};
}

async function updateTabMetadata(tabs) {
  const meta = await getTabMetadata();
  const now = Date.now();
  const currentUrls = new Set();

  for (const tab of tabs || []) {
    if (!tab.url || !TAB_OUT_RULES.isRealTabUrl(tab.url)) continue;
    currentUrls.add(tab.url);
    if (!meta[tab.url]) {
      meta[tab.url] = {
        firstSeenAt: now,
        lastSeenAt: now,
        lastAccessedAt: tab.active ? now : tab.lastAccessed || now,
      };
    } else {
      meta[tab.url].lastSeenAt = now;
      if (tab.active) meta[tab.url].lastAccessedAt = now;
      else if (tab.lastAccessed) meta[tab.url].lastAccessedAt = Math.max(meta[tab.url].lastAccessedAt || 0, tab.lastAccessed);
    }
  }

  for (const [url, record] of Object.entries(meta)) {
    if (!currentUrls.has(url) && record.lastSeenAt && now - record.lastSeenAt > 30 * 86400000) {
      delete meta[url];
    }
  }

  await chrome.storage.local.set({ [TAB_META_STORAGE_KEY]: meta });
  return meta;
}

function getStaleTabs(tabs, metadata) {
  const now = Date.now();
  const duplicateCounts = {};
  for (const tab of tabs || []) duplicateCounts[tab.url] = (duplicateCounts[tab.url] || 0) + 1;

  return (tabs || []).map(tab => {
    const record = metadata[tab.url] || {};
    const openedDays = record.firstSeenAt ? Math.floor((now - record.firstSeenAt) / 86400000) : 0;
    const notViewedDays = record.lastAccessedAt ? Math.floor((now - record.lastAccessedAt) / 86400000) : 0;
    const reasons = [];
    if (duplicateCounts[tab.url] > 1) reasons.push('duplicate');
    if (/search|query|results|\/s\?|\/search/i.test(tab.url || '')) reasons.push('search result');
    if (notViewedDays >= REVIEW_NOT_VIEWED_DAYS) reasons.push(`${notViewedDays}d not viewed`);
    if (openedDays >= REVIEW_OPEN_DAYS) reasons.push(`${openedDays}d open`);
    return { ...tab, staleReasons: reasons, openedDays, notViewedDays };
  }).filter(tab => tab.staleReasons.length > 0);
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

function getDunhuangBackground(backgroundId) {
  return DUNHUANG_BACKGROUNDS.find(item => item.id === backgroundId) || DUNHUANG_BACKGROUNDS[0];
}

function normalizeAppearanceSettings(rawSettings) {
  const raw = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  return {
    backgroundId: getDunhuangBackground(raw.backgroundId).id,
  };
}

async function getAppearanceSettings() {
  const result = await chrome.storage.local.get(APPEARANCE_STORAGE_KEY);
  return normalizeAppearanceSettings(result[APPEARANCE_STORAGE_KEY]);
}

async function setAppearanceSettings(nextSettings) {
  const normalized = normalizeAppearanceSettings(nextSettings);
  await chrome.storage.local.set({ [APPEARANCE_STORAGE_KEY]: normalized });
  appearanceSettings = normalized;
  return normalized;
}

function applyAppearanceSettings(settings = appearanceSettings) {
  const theme = getDunhuangBackground(settings && settings.backgroundId);
  const root = document.documentElement;
  root.style.setProperty('--paper', theme.background);
  root.style.setProperty('--card-bg', theme.card);
  root.style.setProperty('--warm-gray', theme.border);
  root.style.setProperty('--muted', theme.muted);
  root.style.setProperty('--accent-amber', theme.accent);
  root.dataset.background = theme.id;
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
let ruleSettings = TAB_OUT_RULES.normalizeRuleSettings({});
let workspacesState = { workspaces: [] };
let appearanceSettings = normalizeAppearanceSettings({});
let currentActiveTab = null;
let staleTabs = [];
let dashboardRefreshTimer = null;
let lastCenteredCurrentTabKey = '';


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
    return TAB_OUT_RULES.isRealTabUrl(url);
  });
}

async function getCurrentActiveRealTab() {
  const currentWindowId = await getCurrentWindowId();
  const activeInWindow = openTabs.find(tab =>
    tab.active &&
    tab.windowId === currentWindowId &&
    TAB_OUT_RULES.isRealTabUrl(tab.url)
  );
  if (activeInWindow) return activeInWindow;

  if (currentWindowId === null || currentWindowId === undefined) {
    return openTabs.find(tab => tab.active && TAB_OUT_RULES.isRealTabUrl(tab.url)) || null;
  }
  return null;
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
  return group.domain === '__landing-pages__' ? 'Home pages' : (group.label || friendlyDomain(group.domain));
}

function getHostnameForTab(tab) {
  try {
    return new URL(tab.url).hostname;
  } catch {
    return '';
  }
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
  const currentIndex = groups.findIndex(group => (group.tabs || []).some(groupTab => isSameTab(groupTab, tab)));
  if (currentIndex <= 0) return groups;
  const ordered = groups.slice();
  const [currentGroup] = ordered.splice(currentIndex, 1);
  ordered.unshift(currentGroup);
  return ordered;
}

function findDomainCard(domainId) {
  return Array.from(document.querySelectorAll('.mission-card[data-domain-id]'))
    .find(card => card.dataset.domainId === domainId) || null;
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
        <div class="current-tab-group">Hidden on Tab Out pages</div>
      </div>`;
    strip.style.display = 'flex';
    return;
  }

  const domainId = group ? stableDomainId(group.domain) : '';
  const label = getTabLabel(tab);
  const groupLabel = group ? getGroupLabel(group) : 'Not grouped yet';
  const hostname = getHostnameForTab(tab);
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=16` : '';
  const safeTabId = Number.isInteger(tab.id) ? String(tab.id) : '';

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
      <button class="action-btn close-tabs" data-action="close-single-tab" data-tab-id="${escapeAttr(safeTabId)}" data-tab-url="${escapeAttr(tab.url || '')}">
        ${ICONS.close}
        Close
      </button>
    </div>`;
  strip.style.display = 'flex';
}

function currentTabCenterKey(tab, group) {
  if (!tab || !group) return '';
  const tabKey = Number.isInteger(tab.id) ? tab.id : `${tab.windowId || ''}:${tab.url || ''}`;
  return `${tabKey}:${tab.url || ''}:${group.domain || ''}`;
}

function centerCurrentTabInSidePanel(tab, group) {
  const centerKey = currentTabCenterKey(tab, group);
  if (!centerKey || centerKey === lastCenteredCurrentTabKey) return;
  lastCenteredCurrentTabKey = centerKey;

  setTimeout(() => {
    const card = findDomainCard(stableDomainId(group.domain));
    if (!card) return;

    const tabId = Number.isInteger(tab.id) ? String(tab.id) : '';
    const currentChip = Array.from(card.querySelectorAll('.page-chip[data-tab-id]'))
      .find(chip => chip.dataset.tabId === tabId) ||
      card.querySelector('.page-chip.chip-is-current');
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
  const schedule = (delay = 250) => {
    if (dashboardRefreshTimer) clearTimeout(dashboardRefreshTimer);
    dashboardRefreshTimer = setTimeout(() => {
      dashboardRefreshTimer = null;
      if (document.visibilityState !== 'hidden') renderDashboard();
    }, delay);
  };

  try {
    chrome.tabs.onActivated.addListener(() => schedule(80));
    chrome.tabs.onCreated.addListener(() => schedule(500));
    chrome.tabs.onRemoved.addListener(() => schedule(120));
    chrome.tabs.onMoved.addListener(() => schedule(120));
    chrome.tabs.onAttached.addListener(() => schedule(120));
    chrome.tabs.onDetached.addListener(() => schedule(120));
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (
        changeInfo.url ||
        changeInfo.title ||
        changeInfo.groupId !== undefined ||
        changeInfo.status === 'complete'
      ) {
        schedule(350);
      }
    });
    if (chrome.tabGroups && chrome.tabGroups.onUpdated) {
      chrome.tabGroups.onUpdated.addListener(() => schedule(120));
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') schedule(0);
    });
  } catch (err) {
    console.warn('[tab-out] Live tab refresh unavailable:', err);
  }
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

function getManualGroupCounts(state = manualGroupsState, tabs = openTabs) {
  const counts = {};
  for (const group of state.groups || []) counts[group.id] = 0;
  for (const tab of tabs || []) {
    const groupId = TAB_OUT_RULES.getManualGroupIdForUrl(tab && tab.url, state);
    if (typeof counts[groupId] === 'number') counts[groupId] += 1;
  }
  return counts;
}

function renderRulePriority() {
  return `<div class="priority-row">
    ${ruleSettings.ruleOrder.map((type, index) => `
      <div class="priority-chip">
        <span>${RULE_TYPE_LABELS[type] || type}</span>
        <button data-action="move-rule-priority" data-rule-type="${type}" data-direction="-1" title="Move earlier" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button data-action="move-rule-priority" data-rule-type="${type}" data-direction="1" title="Move later" ${index === ruleSettings.ruleOrder.length - 1 ? 'disabled' : ''}>↓</button>
      </div>`).join('')}
  </div>`;
}

function renderCustomRuleRows() {
  if (!ruleSettings.customGroups.length) {
    return '<div class="organizer-empty">No site rules yet</div>';
  }

  return `<div class="rule-list">
    ${ruleSettings.customGroups.map(rule => `
      <div class="rule-pill">
        <span class="custom-group-dot color-${rule.color || 'grey'}"></span>
        <span class="rule-name">${escapeHtml(rule.groupLabel)}</span>
        <span class="rule-match">${escapeHtml(rule.hostname || rule.hostnameEndsWith || (rule.hostnameSuffixes || []).join(', '))}${rule.pathPrefix ? escapeHtml(rule.pathPrefix) : ''}</span>
        <button class="custom-group-delete" data-action="delete-custom-rule" data-rule-id="${escapeAttr(rule.id)}" title="Delete rule">${ICONS.close}</button>
      </div>`).join('')}
  </div>`;
}

function renderWorkspaceRows() {
  if (!workspacesState.workspaces.length) {
    return '<div class="organizer-empty">No saved sets yet</div>';
  }

  return `<div class="workspace-list">
    ${workspacesState.workspaces.slice(0, 5).map(workspace => `
      <div class="workspace-row">
        <div class="workspace-info">
          <span class="workspace-name">${escapeHtml(workspace.name)}</span>
          <span class="workspace-meta">${workspace.tabs.length} tab${workspace.tabs.length !== 1 ? 's' : ''}</span>
        </div>
        <button class="mini-btn" data-action="restore-workspace" data-workspace-id="${escapeAttr(workspace.id)}">Open</button>
        <button class="custom-group-delete" data-action="delete-workspace" data-workspace-id="${escapeAttr(workspace.id)}" title="Delete saved set">${ICONS.close}</button>
      </div>`).join('')}
  </div>`;
}

function renderStaleTabsSummary() {
  if (!staleTabs.length) {
    return '<div class="organizer-empty">Nothing to review</div>';
  }

  const safeReviewCount = getSafeReviewTabs(staleTabs).length;
  const sample = staleTabs.slice(0, 4).map(tab => `
    <div class="stale-row">
      <span class="stale-title">${escapeHtml(cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), ''))}</span>
      <span class="stale-reasons">${escapeHtml(tab.staleReasons.join(', '))}</span>
      <button class="custom-group-delete" data-action="close-stale-tab" data-tab-id="${tab.id}" title="Close tab">${ICONS.close}</button>
    </div>`).join('');

  return `<div class="stale-list">
    ${sample}
    ${safeReviewCount > 0 ? `<div class="stale-actions">
      <button class="mini-btn" data-action="close-all-stale-tabs">Clean duplicates/search</button>
    </div>` : ''}
  </div>`;
}

function renderBackgroundPalette() {
  return `<div class="background-palette">
    ${DUNHUANG_BACKGROUNDS.map(theme => {
      const active = theme.id === appearanceSettings.backgroundId;
      return `<button class="background-swatch${active ? ' is-active' : ''}"
        data-action="set-background-color"
        data-background-id="${escapeAttr(theme.id)}"
        aria-pressed="${active}"
        title="${escapeAttr(theme.name)}"
        style="--swatch-bg:${escapeAttr(theme.background)};--swatch-card:${escapeAttr(theme.card)};--swatch-accent:${escapeAttr(theme.accent)}">
          <span class="background-swatch-chip" aria-hidden="true"></span>
          <span class="background-swatch-name">${escapeHtml(theme.name)}</span>
        </button>`;
    }).join('')}
  </div>`;
}

function staleReasonsForUrl(url) {
  const stale = staleTabs.find(tab => tab.url === url);
  return stale ? stale.staleReasons : [];
}

function renderCustomGroupsPanel() {
  const panel = document.getElementById('customGroupsPanel');
  if (!panel) return;

  const expanded = panel.dataset.settingsExpanded === 'true';
  const toggleHint = expanded ? 'Hide settings' : 'Expand to see more settings';
  const groups = manualGroupsState.groups || [];
  const counts = getManualGroupCounts(manualGroupsState, getRealTabs());
  const groupRows = groups.length
    ? `<div class="custom-group-list">
        ${groups.map(group => `
          <div class="custom-group-pill" data-manual-group-id="${group.id}" data-drop-action="assign-manual-group">
            <span class="custom-group-dot color-${group.color || 'grey'}"></span>
            <span class="custom-group-name">${escapeHtml(group.name)}</span>
            <span class="custom-group-count">${counts[group.id] || 0}</span>
            <button class="custom-group-delete" data-action="delete-manual-group" data-manual-group-id="${escapeAttr(group.id)}" title="Delete group">${ICONS.close}</button>
          </div>`).join('')}
      </div>`
    : '';

  panel.innerHTML = `
    <button class="settings-toggle" data-action="toggle-organizer-settings" aria-expanded="${expanded}" aria-controls="organizerSettingsGrid">
      <span class="settings-toggle-chevron" aria-hidden="true"></span>
      <span class="settings-toggle-copy">
        <span class="settings-toggle-title">More settings</span>
        <span class="settings-toggle-hint">${toggleHint}</span>
      </span>
    </button>

    <div class="organizer-grid" id="organizerSettingsGrid" ${expanded ? '' : 'hidden'}>
      <div class="organizer-block organizer-block-wide">
        <div class="organizer-heading">Dunhuang background</div>
        ${renderBackgroundPalette()}
      </div>

      <div class="organizer-block">
        <div class="organizer-heading">My groups</div>
        <div class="custom-group-create">
          <input id="manualGroupNameInput" class="custom-group-input" type="text" maxlength="40" placeholder="New group">
          <button class="action-btn" data-action="create-manual-group">${ICONS.tabs} Add</button>
        </div>
        ${groupRows || '<div class="organizer-empty">Create a group, then drop tabs here</div>'}
      </div>

      <div class="organizer-block">
        <div class="organizer-heading">Rule order</div>
        ${renderRulePriority()}
      </div>

      <div class="organizer-block">
        <div class="organizer-heading">Site rules</div>
        <div class="custom-rule-create">
          <input id="customRuleNameInput" class="custom-group-input" type="text" maxlength="40" placeholder="Group">
          <input id="customRuleHostInput" class="custom-group-input" type="text" maxlength="120" placeholder="Site">
          <input id="customRulePathInput" class="custom-group-input compact" type="text" maxlength="80" placeholder="Path">
          <button class="action-btn" data-action="create-custom-rule">Add</button>
        </div>
        ${renderCustomRuleRows()}
      </div>

      <div class="organizer-block">
        <div class="organizer-heading">Saved sets</div>
        <div class="custom-group-create">
          <input id="workspaceNameInput" class="custom-group-input" type="text" maxlength="48" placeholder="Set name">
          <button class="action-btn" data-action="save-workspace">Save</button>
        </div>
        ${renderWorkspaceRows()}
      </div>

      <div class="organizer-block organizer-block-wide">
        <div class="organizer-heading">Needs review</div>
        ${renderStaleTabsSummary()}
      </div>
    </div>`;
}

function closeManualGroupMenus() {
  document.querySelectorAll('.manual-group-menu').forEach(menu => menu.remove());
}

function renderManualGroupMenu(anchor, tabUrl, tabTitle) {
  closeManualGroupMenus();

  const menu = document.createElement('div');
  menu.className = 'manual-group-menu';

  const safeUrl = escapeAttr(tabUrl || '');
  const safeTitle = escapeAttr(tabTitle || tabUrl || '');
  const groups = manualGroupsState.groups || [];
  const groupButtons = groups.map(group => `
    <button class="manual-group-menu-item" data-action="assign-manual-group" data-tab-url="${safeUrl}" data-manual-group-id="${escapeAttr(group.id)}">
      <span class="custom-group-dot color-${group.color || 'grey'}"></span>
      <span>${escapeHtml(group.name)}</span>
    </button>`).join('');

  menu.innerHTML = `
    <div class="manual-group-menu-title">My groups</div>
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
    const safeLabel = escapeHtml(label);
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const staleReasons = staleReasonsForUrl(tab.url);
    const staleTag = staleReasons.length ? ` <span class="chip-stale-badge">${escapeHtml(staleReasons[0])}</span>` : '';
    const chipClass = `${count > 1 ? ' chip-has-dupes' : ''}${staleReasons.length ? ' chip-is-stale' : ''}`;
    const safeUrl   = escapeAttr(tab.url || '');
    const safeTitle = escapeAttr(label);
    const safeTabId = Number.isInteger(tab.id) ? String(tab.id) : '';
    const manualGroupId = TAB_OUT_RULES.getManualGroupIdForUrl(tab.url, manualGroupsState);
    const manualAction = manualGroupId
      ? `<button class="chip-action chip-manual" data-action="remove-from-manual-group" data-tab-url="${safeUrl}" title="Remove from group">${ICONS.close}</button>`
      : `<button class="chip-action chip-manual" data-action="open-manual-group-menu" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Add to group">${ICONS.tabs}</button>`;
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" draggable="true" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${safeLabel}</span>${dupeTag}${staleTag}
      <div class="chip-actions">
        ${manualAction}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" data-tab-title="${safeTitle}" title="Save tab">
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
  const hasCurrentTab = currentActiveTab
    ? tabs.some(tab => isSameTab(tab, currentActiveTab))
    : false;

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);
  const displayGroupName = isLanding ? 'Home pages' : (group.label || friendlyDomain(group.domain));

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
    const safeLabel = escapeHtml(label);
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const staleReasons = staleReasonsForUrl(tab.url);
    const staleTag = staleReasons.length ? ` <span class="chip-stale-badge">${escapeHtml(staleReasons[0])}</span>` : '';
    const isCurrent = isSameTab(tab, currentActiveTab);
    const currentTag = isCurrent ? ' <span class="chip-current-badge">Current</span>' : '';
    const chipClass = `${count > 1 ? ' chip-has-dupes' : ''}${staleReasons.length ? ' chip-is-stale' : ''}${isCurrent ? ' chip-is-current' : ''}`;
    const safeUrl   = escapeAttr(tab.url || '');
    const safeTitle = escapeAttr(label);
    const safeTabId = Number.isInteger(tab.id) ? String(tab.id) : '';
    const manualGroupId = TAB_OUT_RULES.getManualGroupIdForUrl(tab.url, manualGroupsState);
    const manualAction = manualGroupId
      ? `<button class="chip-action chip-manual" data-action="remove-from-manual-group" data-tab-url="${safeUrl}" title="Remove from group">${ICONS.close}</button>`
      : `<button class="chip-action chip-manual" data-action="open-manual-group-menu" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Add to group">${ICONS.tabs}</button>`;
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" draggable="true" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${safeLabel}</span>${currentTag}${dupeTag}${staleTag}
      <div class="chip-actions">
        ${manualAction}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-id="${safeTabId}" data-tab-title="${safeTitle}" title="Save tab">
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
          <span class="mission-name">${escapeHtml(displayGroupName)}</span>
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
  const safeDomain = escapeHtml(domain);
  const safeItemId = escapeAttr(item.id);
  const safeUrl = escapeAttr(item.url || '');
  const safeTitle = escapeAttr(item.title || item.url || '');
  const displayTitle = escapeHtml(item.title || item.url || '');
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${safeItemId}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${safeItemId}">
      <div class="deferred-info">
        <a href="${safeUrl}" target="_blank" rel="noopener" class="deferred-title" title="${safeTitle}">
          <img src="${escapeAttr(faviconUrl)}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${displayTitle}
        </a>
        <div class="deferred-meta">
          <span>${safeDomain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${safeItemId}" title="Dismiss">
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
  const safeUrl = escapeAttr(item.url || '');
  const safeTitle = escapeAttr(item.title || item.url || '');
  const displayTitle = escapeHtml(item.title || item.url || '');
  return `
    <div class="archive-item">
      <a href="${safeUrl}" target="_blank" rel="noopener" class="archive-item-title" title="${safeTitle}">
        ${displayTitle}
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
  ruleSettings = await getRuleSettings();
  workspacesState = await getWorkspacesState();
  appearanceSettings = await getAppearanceSettings();
  applyAppearanceSettings(appearanceSettings);
  staleTabs = getStaleTabs(realTabs, await getTabMetadata());
  renderCustomGroupsPanel();

  // --- My groups are explicit. Auto grouping only handles the remainder. ---
  const manualGroups = TAB_OUT_RULES.getManualDashboardGroups(realTabs, manualGroupsState);
  const autoGroupTabs = realTabs.filter(tab => !TAB_OUT_RULES.isManualGroupedTab(tab, manualGroupsState));
  const autoGroups = TAB_OUT_RULES.getDashboardGroups(autoGroupTabs, {
    landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : [],
    customGroups: ruleSettings.customGroups.concat(typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : []),
    semanticGroups: typeof LOCAL_SEMANTIC_GROUPS !== 'undefined' ? LOCAL_SEMANTIC_GROUPS : [],
    ruleOrder: ruleSettings.ruleOrder,
  });
  domainGroups = prioritizeCurrentTabGroup(manualGroups.concat(autoGroups), currentActiveTab);
  const currentGroup = findGroupForTab(domainGroups, currentActiveTab);
  renderCurrentTabStrip(currentActiveTab, currentGroup);

  // --- Render group cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  const hasOrganizerContent =
    manualGroupsState.groups.length > 0 ||
    ruleSettings.customGroups.length > 0 ||
    workspacesState.workspaces.length > 0 ||
    staleTabs.length > 0;

  if ((domainGroups.length > 0 || hasOrganizerContent) && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} group${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.length
      ? domainGroups.map(g => renderDomainCard(g)).join('')
      : '<div class="organizer-empty">No open tabs</div>';
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

  // --- Render saved tabs column ---
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

  // ---- Expand/collapse the optional settings panel ----
  if (action === 'toggle-organizer-settings') {
    e.stopPropagation();
    const panel = document.getElementById('customGroupsPanel');
    if (!panel) return;
    panel.dataset.settingsExpanded = panel.dataset.settingsExpanded === 'true' ? 'false' : 'true';
    renderCustomGroupsPanel();
    return;
  }

  // ---- Pick a Dunhuang background color ----
  if (action === 'set-background-color') {
    e.stopPropagation();
    const theme = getDunhuangBackground(actionEl.dataset.backgroundId);
    await setAppearanceSettings({ backgroundId: theme.id });
    applyAppearanceSettings(appearanceSettings);
    renderCustomGroupsPanel();
    showToast(`Background: ${theme.name}`);
    return;
  }

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
    showToast(enabled ? `Auto groups on${grouped ? ` - grouped ${grouped}` : ''}` : 'Auto groups off');
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
    showToast(response && response.ok ? 'Side panel opened' : 'Use the toolbar icon to open the side panel');
    return;
  }

  // ---- Create a manual group ----
  if (action === 'create-manual-group') {
    e.stopPropagation();
    const input = document.getElementById('manualGroupNameInput');
    const name = input && input.value.trim();
    if (!name) {
      showToast('Name the group first');
      return;
    }

    const group = await createManualGroup(name);
    if (input) input.value = '';
    renderCustomGroupsPanel();
    showToast(group ? `Created ${group.name}` : 'Could not create group');
    return;
  }

  // ---- Delete a manual group ----
  if (action === 'delete-manual-group') {
    e.stopPropagation();
    const groupId = actionEl.dataset.manualGroupId;
    const result = await deleteManualGroup(groupId);
    if (result.deleted) {
      for (const url of result.affectedUrls) {
        await sendRuntimeMessage({ type: GROUPING_MESSAGES.APPLY_MANUAL_GROUPING, url });
      }
      showToast('Group deleted');
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

  // ---- Assign a tab to a manual group ----
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

  // ---- Create a manual group and assign the tab to it ----
  if (action === 'create-and-assign-manual-group') {
    e.stopPropagation();
    const menu = actionEl.closest('.manual-group-menu');
    const input = menu && menu.querySelector('.manual-group-menu-input');
    const name = input && input.value.trim();
    const tabUrl = actionEl.dataset.tabUrl;
    if (!name || !tabUrl) {
      showToast('Name the group first');
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

  // ---- Remove a tab from manual grouping ----
  if (action === 'remove-from-manual-group') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    await removeTabFromManualGroup(tabUrl);
    await sendRuntimeMessage({ type: GROUPING_MESSAGES.APPLY_MANUAL_GROUPING, url: tabUrl });
    showToast('Removed from group');
    await renderDashboard();
    return;
  }

  // ---- Add a site rule from the UI ----
  if (action === 'create-custom-rule') {
    e.stopPropagation();
    const nameInput = document.getElementById('customRuleNameInput');
    const hostInput = document.getElementById('customRuleHostInput');
    const pathInput = document.getElementById('customRulePathInput');
    const rule = await createCustomRule({
      groupLabel: nameInput && nameInput.value,
      hostname: hostInput && hostInput.value,
      pathPrefix: pathInput && pathInput.value,
    });
    if (!rule) {
      showToast('Add a group name and site');
      return;
    }
    if (nameInput) nameInput.value = '';
    if (hostInput) hostInput.value = '';
    if (pathInput) pathInput.value = '';
    await applyAutoGroupingNow();
    showToast(`Site rule added: ${rule.groupLabel}`);
    await renderDashboard();
    return;
  }

  // ---- Delete a site rule ----
  if (action === 'delete-custom-rule') {
    e.stopPropagation();
    const deleted = await deleteCustomRule(actionEl.dataset.ruleId);
    if (deleted) {
      await applyAutoGroupingNow();
      showToast('Rule deleted');
      await renderDashboard();
    }
    return;
  }

  // ---- Move rule priority ----
  if (action === 'move-rule-priority') {
    e.stopPropagation();
    await moveRulePriority(actionEl.dataset.ruleType, Number(actionEl.dataset.direction || 0));
    await applyAutoGroupingNow();
    showToast('Rule order updated');
    await renderDashboard();
    return;
  }

  // ---- Save current open tabs as a set ----
  if (action === 'save-workspace') {
    e.stopPropagation();
    const input = document.getElementById('workspaceNameInput');
    const workspace = await saveCurrentWorkspace(input && input.value);
    if (!workspace) {
      showToast('Name the set first');
      return;
    }
    if (input) input.value = '';
    showToast(`Saved ${workspace.tabs.length} tabs`);
    await renderDashboard();
    return;
  }

  // ---- Open a saved set ----
  if (action === 'restore-workspace') {
    e.stopPropagation();
    const opened = await restoreWorkspace(actionEl.dataset.workspaceId);
    showToast(opened > 0 ? `Opened ${opened} tab${opened !== 1 ? 's' : ''}` : 'Set already open');
    await renderDashboard();
    return;
  }

  // ---- Delete a saved set ----
  if (action === 'delete-workspace') {
    e.stopPropagation();
    const deleted = await deleteWorkspace(actionEl.dataset.workspaceId);
    if (deleted) {
      showToast('Set deleted');
      await renderDashboard();
    }
    return;
  }

  // ---- Close one review tab ----
  if (action === 'close-stale-tab') {
    e.stopPropagation();
    const tabId = Number(actionEl.dataset.tabId);
    if (Number.isInteger(tabId)) await closeTabsByIds([tabId]);
    showToast('Closed tab');
    await renderDashboard();
    return;
  }

  // ---- Clean up review tabs that are safe to close automatically ----
  if (action === 'close-all-stale-tabs') {
    e.stopPropagation();
    const closed = await closeReviewTabsSafely(staleTabs);
    showToast(closed > 0 ? `Closed ${closed} safe item${closed !== 1 ? 's' : ''}` : 'Nothing safe to close');
    await renderDashboard();
    return;
  }

  // ---- Jump to the group that contains the current tab ----
  if (action === 'show-current-group') {
    e.stopPropagation();
    const card = findDomainCard(actionEl.dataset.domainId);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('current-group-pulse');
    setTimeout(() => card.classList.remove('current-group-pulse'), 900);
    return;
  }

  const card = actionEl.closest('.mission-card');

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
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    const tabId = tabIdFromElement(actionEl);
    if (tabId !== null) {
      await closeTabsByIds([tabId]);
    } else if (tabUrl) {
      const allTabs = await chrome.tabs.query({});
      const match = allTabs.find(t => t.url === tabUrl);
      if (match) await closeTabsByIds([match.id]);
    } else {
      return;
    }
    playCloseSound();
    showToast('Tab closed');
    await renderDashboard();
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
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
    const tabId = tabIdFromElement(actionEl);
    if (tabId !== null) {
      await closeTabsByIds([tabId]);
    } else {
      const allTabs = await chrome.tabs.query({});
      const match = allTabs.find(t => t.url === tabUrl);
      if (match) await closeTabsByIds([match.id]);
    }

    showToast('Saved tab');
    await renderDashboard();
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
    const group = domainGroups.find(g => stableDomainId(g.domain) === domainId);
    if (!group) return;

    const tabIds = group.tabs.map(t => t.id).filter(Number.isInteger);
    await closeTabsByIds(tabIds);

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Home pages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''} from ${groupLabel}`);

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

document.addEventListener('dragstart', (e) => {
  const chip = e.target.closest('.page-chip[data-tab-url]');
  if (!chip) return;
  e.dataTransfer.setData('text/tab-url', chip.dataset.tabUrl || '');
  e.dataTransfer.setData('text/plain', chip.dataset.tabUrl || '');
  e.dataTransfer.effectAllowed = 'move';
  chip.classList.add('dragging');
});

document.addEventListener('dragend', (e) => {
  const chip = e.target.closest('.page-chip');
  if (chip) chip.classList.remove('dragging');
  document.querySelectorAll('.custom-group-pill.drop-target').forEach(el => el.classList.remove('drop-target'));
});

document.addEventListener('dragover', (e) => {
  const target = e.target.closest('[data-drop-action="assign-manual-group"]');
  if (!target) return;
  e.preventDefault();
  target.classList.add('drop-target');
  e.dataTransfer.dropEffect = 'move';
});

document.addEventListener('dragleave', (e) => {
  const target = e.target.closest('[data-drop-action="assign-manual-group"]');
  if (target) target.classList.remove('drop-target');
});

document.addEventListener('drop', async (e) => {
  const target = e.target.closest('[data-drop-action="assign-manual-group"]');
  if (!target) return;
  e.preventDefault();
  target.classList.remove('drop-target');

  const tabUrl = e.dataTransfer.getData('text/tab-url');
  const fallbackUrl = e.dataTransfer.getData('text/plain');
  const groupId = target.dataset.manualGroupId;
  const group = await assignTabToManualGroup(tabUrl || fallbackUrl, groupId);
  if (group) {
    await sendRuntimeMessage({ type: GROUPING_MESSAGES.APPLY_MANUAL_GROUPING, url: tabUrl || fallbackUrl });
    showToast(`Added to ${group.name}`);
    await renderDashboard();
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
    showToast(group ? `Created ${group.name}` : 'Name the group first');
    return;
  }

  if (e.target.closest('#customRuleNameInput, #customRuleHostInput, #customRulePathInput')) {
    const addButton = document.querySelector('[data-action="create-custom-rule"]');
    if (addButton) addButton.click();
    return;
  }

  const workspaceInput = e.target.closest('#workspaceNameInput');
  if (workspaceInput) {
    const saveButton = document.querySelector('[data-action="save-workspace"]');
    if (saveButton) saveButton.click();
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
async function initDashboard() {
  appearanceSettings = await getAppearanceSettings();
  applyAppearanceSettings(appearanceSettings);
  setupLiveDashboardRefresh();
  await renderDashboard();
}

initDashboard();
