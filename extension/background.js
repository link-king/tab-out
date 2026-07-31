/**
 * background.js — badge, native Chrome tab groups, and side panel behavior.
 */

importScripts('tab-rules.js', 'config.local.js');

const AUTO_GROUP_SETTINGS_KEY = 'tabOutAutoGroupSettings';
const QUICK_RETURN_STORAGE_KEY = 'tabOutQuickReturn';
const QUICK_RETURN_RETENTION_MS = 72 * 60 * 60 * 1000;
const QUICK_RETURN_MAX_ITEMS = 200;
const QUICK_RETURN_TAB_SNAPSHOT_PREFIX = 'tabOutQuickReturnTab:';
const QUICK_RETURN_GROUP_TRANSITION_GRACE_MS = 5000;
const DEFAULT_AUTO_GROUP_SETTINGS = {
  enabled: true,
  groupExistingOnStartup: true,
  includeAlreadyGrouped: false,
};

const MESSAGE_TYPES = {
  GET_GROUPING_STATE: 'TAB_OUT_GET_GROUPING_STATE',
  SET_AUTO_GROUPING: 'TAB_OUT_SET_AUTO_GROUPING',
  GROUP_TABS_NOW: 'TAB_OUT_GROUP_TABS_NOW',
  APPLY_MANUAL_GROUPING: 'TAB_OUT_APPLY_MANUAL_GROUPING',
  SET_GROUPS_COLLAPSED: 'TAB_OUT_SET_GROUPS_COLLAPSED',
  OPEN_SIDE_PANEL: 'TAB_OUT_OPEN_SIDE_PANEL',
  APPEND_QUICK_RETURN: 'TAB_OUT_APPEND_QUICK_RETURN',
  REMOVE_QUICK_RETURN: 'TAB_OUT_REMOVE_QUICK_RETURN',
  PRUNE_QUICK_RETURN: 'TAB_OUT_PRUNE_QUICK_RETURN',
};

const pendingTabTimers = new Map();
const quickReturnTabSnapshots = new Map();
const quickReturnTabSnapshotTasks = new Map();
const quickReturnTabSnapshotVersions = new Map();
let quickReturnCaptureQueue = Promise.resolve();

function quickReturnSnapshotKey(tabId) {
  return `${QUICK_RETURN_TAB_SNAPSHOT_PREFIX}${tabId}`;
}

function getPersistableFaviconUrl(url) {
  const value = String(url || '');
  return /^(https?:|data:image\/)/i.test(value) ? value : '';
}

async function getQuickReturnGroupSnapshot(tab) {
  if (!Number.isInteger(tab.groupId) || tab.groupId < 0) return null;

  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    if (!group || !group.title) return null;
    return {
      title: group.title,
      color: group.color || 'grey',
      collapsed: group.collapsed === true,
    };
  } catch {
    return null;
  }
}

async function readStoredQuickReturnTabSnapshot(tabId) {
  const storageKey = quickReturnSnapshotKey(tabId);
  try {
    const result = await chrome.storage.session.get(storageKey);
    return result[storageKey] || null;
  } catch {
    return null;
  }
}

async function commitQuickReturnTabSnapshot(tab, version) {
  const storageKey = quickReturnSnapshotKey(tab.id);
  const url = tab.url || tab.pendingUrl || '';

  if (!TAB_OUT_RULES.isRealTabUrl(url)) {
    if (quickReturnTabSnapshotVersions.get(tab.id) !== version) return;
    quickReturnTabSnapshots.delete(tab.id);
    try {
      await chrome.storage.session.remove(storageKey);
    } catch {
      // In-memory caching still covers the active service-worker lifetime.
    }
    return;
  }

  const previous = quickReturnTabSnapshots.get(tab.id) ||
    await readStoredQuickReturnTabSnapshot(tab.id);
  const snapshot = {
    sourceTabId: tab.id,
    url,
    title: tab.title || url,
    favIconUrl: getPersistableFaviconUrl(tab.favIconUrl),
    originalWindowId: tab.windowId,
    originalIndex: tab.index,
    pinned: tab.pinned === true,
    nativeGroupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
    group: null,
    lastKnownGroup: null,
    ungroupedAt: null,
  };

  const group = await getQuickReturnGroupSnapshot(tab);
  if (quickReturnTabSnapshotVersions.get(tab.id) !== version) return;
  if (group) {
    snapshot.group = group;
  } else if (
    snapshot.nativeGroupId >= 0 &&
    previous &&
    previous.nativeGroupId === snapshot.nativeGroupId &&
    previous.group
  ) {
    snapshot.group = previous.group;
  }
  if (snapshot.group) {
    snapshot.lastKnownGroup = snapshot.group;
  } else if (snapshot.nativeGroupId < 0 && previous) {
    snapshot.lastKnownGroup = previous.group || previous.lastKnownGroup || null;
    snapshot.ungroupedAt = previous.group
      ? Date.now()
      : previous.ungroupedAt || null;
  }
  quickReturnTabSnapshots.set(tab.id, snapshot);

  try {
    await chrome.storage.session.set({ [storageKey]: snapshot });
  } catch {
    // Session storage is an optimization; the live cache remains usable.
  }
}

function cacheQuickReturnTabSnapshot(tab) {
  if (!tab || !Number.isInteger(tab.id)) return Promise.resolve();

  const version = (quickReturnTabSnapshotVersions.get(tab.id) || 0) + 1;
  quickReturnTabSnapshotVersions.set(tab.id, version);
  const previousTask = quickReturnTabSnapshotTasks.get(tab.id) || Promise.resolve();
  const task = previousTask
    .catch(() => {})
    .then(() => commitQuickReturnTabSnapshot(tab, version));
  quickReturnTabSnapshotTasks.set(tab.id, task);
  const clearTask = () => {
    if (quickReturnTabSnapshotTasks.get(tab.id) === task) {
      quickReturnTabSnapshotTasks.delete(tab.id);
    }
  };
  task.then(clearTask, clearTask);
  return task;
}

async function takeQuickReturnTabSnapshot(tabId) {
  const storageKey = quickReturnSnapshotKey(tabId);
  while (quickReturnTabSnapshotTasks.has(tabId)) {
    const task = quickReturnTabSnapshotTasks.get(tabId);
    await task.catch(() => {});
    if (quickReturnTabSnapshotTasks.get(tabId) === task) {
      quickReturnTabSnapshotTasks.delete(tabId);
    }
  }

  let snapshot = quickReturnTabSnapshots.get(tabId) || null;

  if (!snapshot) {
    snapshot = await readStoredQuickReturnTabSnapshot(tabId);
  }

  quickReturnTabSnapshots.delete(tabId);
  quickReturnTabSnapshotVersions.delete(tabId);
  try {
    await chrome.storage.session.remove(storageKey);
  } catch {
    // Nothing else to clean up when session storage is unavailable.
  }
  return snapshot;
}

function isQuickReturnItemFresh(item, now = Date.now()) {
  if (!item || !item.id || !TAB_OUT_RULES.isRealTabUrl(item.url)) return false;
  const closedAt = Date.parse(item.closedAt || '');
  return Number.isFinite(closedAt) && now - closedAt <= QUICK_RETURN_RETENTION_MS;
}

function normalizeQuickReturnItems(items, now = Date.now()) {
  return (Array.isArray(items) ? items : [])
    .filter(item => isQuickReturnItemFresh(item, now))
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt))
    .slice(0, QUICK_RETURN_MAX_ITEMS);
}

function isSameQuickReturnClose(left, right) {
  if (!left || !right) return false;
  if (String(left.id || '') === String(right.id || '')) return true;

  const leftTabId = Number(left.sourceTabId);
  const rightTabId = Number(right.sourceTabId);
  if (!Number.isInteger(leftTabId) || leftTabId !== rightTabId) return false;

  const leftClosedAt = Date.parse(left.closedAt || '');
  const rightClosedAt = Date.parse(right.closedAt || '');
  return Number.isFinite(leftClosedAt) &&
    Number.isFinite(rightClosedAt) &&
    Math.abs(leftClosedAt - rightClosedAt) < 15000;
}

async function mutateQuickReturnItems(mutator) {
  const result = await chrome.storage.local.get(QUICK_RETURN_STORAGE_KEY);
  const stored = Array.isArray(result[QUICK_RETURN_STORAGE_KEY])
    ? result[QUICK_RETURN_STORAGE_KEY]
    : [];
  const current = normalizeQuickReturnItems(stored);
  const next = normalizeQuickReturnItems(await mutator(current));
  await chrome.storage.local.set({ [QUICK_RETURN_STORAGE_KEY]: next });
  return { items: next, previousCount: current.length };
}

function queueQuickReturnMutation(mutator) {
  const result = quickReturnCaptureQueue
    .catch(() => {})
    .then(() => mutateQuickReturnItems(mutator));
  quickReturnCaptureQueue = result.catch(err => {
    console.warn('[tab-out] Could not update Quick Return:', err);
  });
  return result;
}

function appendQuickReturnItems(items) {
  const incoming = normalizeQuickReturnItems(items);
  if (incoming.length === 0) {
    return queueQuickReturnMutation(current => current)
      .then(result => ({ ...result, added: 0 }));
  }

  return queueQuickReturnMutation(current => {
    const merged = [];
    for (const item of [...incoming, ...current]) {
      if (!merged.some(existing => isSameQuickReturnClose(existing, item))) {
        merged.push(item);
      }
    }
    return merged;
  }).then(result => ({
    ...result,
    added: Math.max(0, result.items.length - result.previousCount),
  }));
}

function removeQuickReturnItems(ids) {
  const idSet = new Set((ids || []).map(id => String(id || '')).filter(Boolean));
  return queueQuickReturnMutation(current => (
    idSet.size === 0 ? current : current.filter(item => !idSet.has(String(item.id || '')))
  )).then(result => ({
    ...result,
    removed: Math.max(0, result.previousCount - result.items.length),
  }));
}

async function captureRemovedTabForQuickReturn(tabId, removeInfo) {
  const snapshot = await takeQuickReturnTabSnapshot(tabId);
  if (!snapshot || removeInfo.isWindowClosing || !TAB_OUT_RULES.isRealTabUrl(snapshot.url)) return;

  const now = Date.now();
  const closedAt = new Date(now).toISOString();
  const recentlyUngrouped = Number.isFinite(snapshot.ungroupedAt) &&
    now - snapshot.ungroupedAt <= QUICK_RETURN_GROUP_TRANSITION_GRACE_MS;
  const group = snapshot.group || (recentlyUngrouped ? snapshot.lastKnownGroup : null);
  const {
    nativeGroupId,
    lastKnownGroup,
    ungroupedAt,
    ...restoredSnapshot
  } = snapshot;
  const item = {
    id: `quick-native-${now.toString(36)}-${tabId}`,
    ...restoredSnapshot,
    sourceTabId: tabId,
    closedAt,
    group,
  };
  await appendQuickReturnItems([item]);
}

function queueRemovedTabCapture(tabId, removeInfo) {
  captureRemovedTabForQuickReturn(tabId, removeInfo).catch(err => {
    console.warn('[tab-out] Could not capture closed tab for Quick Return:', err);
  });
}

async function cacheAllTabsForQuickReturn() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => cacheQuickReturnTabSnapshot(tab)));
}

function getLocalRuleOverrides() {
  return TAB_OUT_RULES.normalizeRuleOverrides({
    landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : [],
    customGroups: typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [],
    semanticGroups: typeof LOCAL_SEMANTIC_GROUPS !== 'undefined' ? LOCAL_SEMANTIC_GROUPS : [],
  });
}

// ─── Badge updater ────────────────────────────────────────────────────────────

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const count = tabs.filter(t => TAB_OUT_RULES.isRealTabUrl(t.url)).length;

    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (count === 0) return;

    let color;
    if (count <= 10) color = '#3d7a4a';
    else if (count <= 20) color = '#b8892e';
    else color = '#b35a5a';

    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function getAutoGroupSettings() {
  const result = await chrome.storage.local.get(AUTO_GROUP_SETTINGS_KEY);
  return {
    ...DEFAULT_AUTO_GROUP_SETTINGS,
    ...(result[AUTO_GROUP_SETTINGS_KEY] || {}),
  };
}

async function setAutoGroupSettings(patch) {
  const settings = {
    ...(await getAutoGroupSettings()),
    ...patch,
  };
  await chrome.storage.local.set({ [AUTO_GROUP_SETTINGS_KEY]: settings });
  return settings;
}

async function ensureAutoGroupSettings() {
  const result = await chrome.storage.local.get(AUTO_GROUP_SETTINGS_KEY);
  if (!result[AUTO_GROUP_SETTINGS_KEY]) {
    await chrome.storage.local.set({ [AUTO_GROUP_SETTINGS_KEY]: DEFAULT_AUTO_GROUP_SETTINGS });
  }
  return getAutoGroupSettings();
}

async function getManualGroupsState() {
  const result = await chrome.storage.local.get(TAB_OUT_RULES.MANUAL_GROUPS_STORAGE_KEY);
  return TAB_OUT_RULES.normalizeManualGroupsState(result[TAB_OUT_RULES.MANUAL_GROUPS_STORAGE_KEY]);
}

// ─── Native Chrome Tab Groups ────────────────────────────────────────────────

function bucketKey(windowId, spec) {
  return `${windowId}:${spec.key}`;
}

async function getExistingGroup(windowId, label) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find(group => group.title === label) || null;
}

async function ensureChromeGroup(windowId, spec, tabIds) {
  if (!tabIds.length) return null;

  const existing = await getExistingGroup(windowId, spec.label);
  const groupId = existing
    ? await chrome.tabs.group({ groupId: existing.id, tabIds })
    : await chrome.tabs.group({ tabIds });

  await chrome.tabGroups.update(groupId, {
    title: spec.label,
    color: TAB_OUT_RULES.normalizeGroupColor(spec.color),
    collapsed: false,
  });

  return groupId;
}

async function groupTabs(tabs, options = {}) {
  const includeAlreadyGrouped = options.includeAlreadyGrouped === true;
  const manualGroupsState = options.manualGroupsState || await getManualGroupsState();
  const buckets = new Map();
  let skippedGrouped = 0;
  let skippedPinned = 0;
  let skippedInternal = 0;
  let skippedManual = 0;
  const candidateTabs = [];

  for (const tab of tabs) {
    if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') continue;

    if (tab.pinned) {
      skippedPinned += 1;
      continue;
    }
    if (!TAB_OUT_RULES.isRealTabUrl(tab.url)) {
      skippedInternal += 1;
      continue;
    }
    if (TAB_OUT_RULES.isManualGroupedTab(tab, manualGroupsState)) {
      skippedManual += 1;
      continue;
    }
    if (!includeAlreadyGrouped && tab.groupId !== TAB_OUT_RULES.UNGROUPED_TAB_ID) {
      skippedGrouped += 1;
      continue;
    }

    candidateTabs.push(tab);
  }

  const tabsByWindow = new Map();
  for (const tab of candidateTabs) {
    if (!tabsByWindow.has(tab.windowId)) tabsByWindow.set(tab.windowId, []);
    tabsByWindow.get(tab.windowId).push(tab);
  }

  const ruleOverrides = getLocalRuleOverrides();
  for (const [windowId, windowTabs] of tabsByWindow.entries()) {
    const groups = TAB_OUT_RULES.getDashboardGroups(windowTabs, ruleOverrides);
    for (const group of groups) {
      const spec = {
        key: group.domain,
        label: group.label || TAB_OUT_RULES.friendlyDomain(group.domain),
        color: TAB_OUT_RULES.normalizeGroupColor(group.color),
        isCustom: group.isCustom === true,
      };
      const key = bucketKey(windowId, spec);
      if (!buckets.has(key)) {
        buckets.set(key, {
          windowId,
          spec,
          tabIds: [],
        });
      }
      buckets.get(key).tabIds.push(...group.tabs.map(tab => tab.id));
    }
  }

  let groupedTabs = 0;
  let groupsTouched = 0;
  const touchedLabels = [];

  for (const bucket of buckets.values()) {
    try {
      const groupId = await ensureChromeGroup(bucket.windowId, bucket.spec, bucket.tabIds);
      if (groupId !== null) {
        groupedTabs += bucket.tabIds.length;
        groupsTouched += 1;
        touchedLabels.push(bucket.spec.label);
      }
    } catch (err) {
      console.warn('[tab-out] Failed to group tabs:', bucket.spec.label, err);
    }
  }

  return {
    groupedTabs,
    groupsTouched,
    skippedGrouped,
    skippedPinned,
    skippedInternal,
    skippedManual,
    touchedLabels: [...new Set(touchedLabels)],
  };
}

async function groupAllOpenTabs(options = {}) {
  const tabs = await chrome.tabs.query({});
  return groupTabs(tabs, options);
}

async function applyManualGroupingForUrl(url) {
  const manualGroupsState = await getManualGroupsState();
  const groupId = TAB_OUT_RULES.getManualGroupIdForUrl(url, manualGroupsState);
  const manualGroup = manualGroupsState.groups.find(group => group.id === groupId);
  const allTabs = await chrome.tabs.query({});
  const tabs = allTabs.filter(tab => tab.url === url);

  if (!manualGroup || tabs.length === 0) {
    if (!manualGroup && tabs.length > 0) {
      return groupTabs(tabs, { includeAlreadyGrouped: true, manualGroupsState });
    }
    return { groupedTabs: 0, groupsTouched: 0, skippedManual: 0 };
  }

  const tabsByWindow = new Map();
  for (const tab of tabs) {
    if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') continue;
    if (tab.pinned || !TAB_OUT_RULES.isRealTabUrl(tab.url)) continue;
    if (!tabsByWindow.has(tab.windowId)) tabsByWindow.set(tab.windowId, []);
    tabsByWindow.get(tab.windowId).push(tab);
  }

  let groupedTabs = 0;
  let groupsTouched = 0;
  for (const [windowId, windowTabs] of tabsByWindow.entries()) {
    const groupIdInChrome = await ensureChromeGroup(windowId, {
      key: 'manual:' + manualGroup.id,
      label: manualGroup.name,
      color: TAB_OUT_RULES.normalizeGroupColor(manualGroup.color),
      isManual: true,
    }, windowTabs.map(tab => tab.id));

    if (groupIdInChrome !== null) {
      groupedTabs += windowTabs.length;
      groupsTouched += 1;
    }
  }

  return { groupedTabs, groupsTouched, skippedManual: 0 };
}

async function groupSingleTab(tabId) {
  const settings = await getAutoGroupSettings();
  if (!settings.enabled) return { groupedTabs: 0, groupsTouched: 0 };

  try {
    const tab = await chrome.tabs.get(tabId);
    return groupTabs([tab], { includeAlreadyGrouped: settings.includeAlreadyGrouped });
  } catch {
    return { groupedTabs: 0, groupsTouched: 0 };
  }
}

function scheduleTabGrouping(tabId, delay = 800) {
  if (!tabId) return;
  if (pendingTabTimers.has(tabId)) clearTimeout(pendingTabTimers.get(tabId));

  const timer = setTimeout(async () => {
    pendingTabTimers.delete(tabId);
    await groupSingleTab(tabId);
    try {
      await cacheQuickReturnTabSnapshot(await chrome.tabs.get(tabId));
    } catch {
      // The tab may have closed while grouping was queued.
    }
    await updateBadge();
  }, delay);

  pendingTabTimers.set(tabId, timer);
}

async function getGroupingState() {
  const settings = await getAutoGroupSettings();
  const manualGroupsState = await getManualGroupsState();
  const tabs = await chrome.tabs.query({});
  const realTabs = tabs.filter(t => TAB_OUT_RULES.isRealTabUrl(t.url) && !t.pinned);
  const ungroupedTabs = realTabs.filter(t => t.groupId === TAB_OUT_RULES.UNGROUPED_TAB_ID);
  const manualGroupedTabs = realTabs.filter(t => TAB_OUT_RULES.isManualGroupedTab(t, manualGroupsState));

  return {
    settings,
    manualGroups: manualGroupsState.groups,
    ruleOverrides: getLocalRuleOverrides(),
    rules: TAB_OUT_RULES.DEFAULT_SEMANTIC_GROUPS.map(rule => ({
      key: rule.key,
      label: rule.label,
    })),
    stats: {
      realTabs: realTabs.length,
      ungroupedTabs: ungroupedTabs.length,
      groupedTabs: realTabs.length - ungroupedTabs.length,
      manualGroupedTabs: manualGroupedTabs.length,
    },
  };
}

async function setGroupsCollapsed(windowId, collapsed) {
  const groups = await chrome.tabGroups.query({ windowId });
  let updated = 0;

  for (const group of groups) {
    if (group.collapsed === collapsed) continue;
    await chrome.tabGroups.update(group.id, { collapsed });
    updated += 1;
  }

  return {
    groupsTouched: updated,
    totalGroups: groups.length,
    collapsed,
  };
}

// ─── Side panel ──────────────────────────────────────────────────────────────

async function setupSidePanel() {
  if (!chrome.sidePanel) return;

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn('[tab-out] Could not set side panel behavior:', err);
  }
}

async function openSidePanel(windowId) {
  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    return { ok: false, error: 'Side panel API is unavailable in this Chrome version.' };
  }

  try {
    await chrome.sidePanel.open({ windowId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ─── Messages from Tab Out UI ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message && message.type) {
      case MESSAGE_TYPES.GET_GROUPING_STATE:
        return { ok: true, state: await getGroupingState() };

      case MESSAGE_TYPES.SET_AUTO_GROUPING: {
        const settings = await setAutoGroupSettings({ enabled: message.enabled === true });
        let result = { groupedTabs: 0, groupsTouched: 0 };
        if (settings.enabled) result = await groupAllOpenTabs({ includeAlreadyGrouped: false });
        return { ok: true, settings, result, state: await getGroupingState() };
      }

      case MESSAGE_TYPES.GROUP_TABS_NOW: {
        const result = await groupAllOpenTabs({ includeAlreadyGrouped: true });
        return { ok: true, result, state: await getGroupingState() };
      }

      case MESSAGE_TYPES.APPLY_MANUAL_GROUPING: {
        const result = await applyManualGroupingForUrl(message.url);
        return { ok: true, result, state: await getGroupingState() };
      }

      case MESSAGE_TYPES.SET_GROUPS_COLLAPSED: {
        const windowId = typeof message.windowId === 'number'
          ? message.windowId
          : sender.tab && sender.tab.windowId
          ? sender.tab.windowId
          : (await chrome.windows.getCurrent()).id;
        const result = await setGroupsCollapsed(windowId, message.collapsed === true);
        return { ok: true, result, state: await getGroupingState() };
      }

      case MESSAGE_TYPES.OPEN_SIDE_PANEL: {
        const windowId = typeof message.windowId === 'number'
          ? message.windowId
          : sender.tab && sender.tab.windowId
          ? sender.tab.windowId
          : (await chrome.windows.getCurrent()).id;
        return await openSidePanel(windowId);
      }

      case MESSAGE_TYPES.APPEND_QUICK_RETURN: {
        const result = await appendQuickReturnItems(message.items);
        return { ok: true, ...result };
      }

      case MESSAGE_TYPES.REMOVE_QUICK_RETURN: {
        const result = await removeQuickReturnItems(message.ids);
        return { ok: true, ...result };
      }

      case MESSAGE_TYPES.PRUNE_QUICK_RETURN: {
        const result = await queueQuickReturnMutation(current => current);
        return { ok: true, ...result };
      }

      default:
        return { ok: false, error: 'Unknown message type.' };
    }
  })()
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));

  return true;
});

// ─── Event listeners ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAutoGroupSettings();
  await setupSidePanel();
  await updateBadge();

  const settings = await getAutoGroupSettings();
  if (settings.enabled && settings.groupExistingOnStartup) {
    await groupAllOpenTabs({ includeAlreadyGrouped: false });
  }
  await cacheAllTabsForQuickReturn();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAutoGroupSettings();
  await setupSidePanel();
  await updateBadge();

  const settings = await getAutoGroupSettings();
  if (settings.enabled && settings.groupExistingOnStartup) {
    await groupAllOpenTabs({ includeAlreadyGrouped: false });
  }
  await cacheAllTabsForQuickReturn();
});

chrome.tabs.onCreated.addListener(tab => {
  updateBadge();
  cacheQuickReturnTabSnapshot(tab);
  scheduleTabGrouping(tab.id);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  updateBadge();
  queueRemovedTabCapture(tabId, removeInfo);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  updateBadge();
  cacheQuickReturnTabSnapshot(tab);
  if (changeInfo.url || changeInfo.status === 'complete') {
    scheduleTabGrouping(tabId);
  }
});

chrome.tabs.onAttached.addListener(tabId => {
  chrome.tabs.get(tabId).then(cacheQuickReturnTabSnapshot).catch(() => {});
  scheduleTabGrouping(tabId);
});

chrome.tabs.onMoved.addListener(tabId => {
  chrome.tabs.get(tabId).then(cacheQuickReturnTabSnapshot).catch(() => {});
});

chrome.tabGroups.onUpdated.addListener(group => {
  chrome.tabs.query({ groupId: group.id })
    .then(tabs => Promise.all(tabs.map(tab => cacheQuickReturnTabSnapshot(tab))))
    .catch(() => {});
});

// ─── Initial run ─────────────────────────────────────────────────────────────

ensureAutoGroupSettings()
  .then(async settings => {
    await setupSidePanel();
    await updateBadge();
    if (settings.enabled && settings.groupExistingOnStartup) {
      await groupAllOpenTabs({ includeAlreadyGrouped: false });
    }
    await cacheAllTabsForQuickReturn();
  })
  .catch(() => updateBadge());
