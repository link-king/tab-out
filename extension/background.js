/**
 * background.js — badge, native Chrome tab groups, and side panel behavior.
 */

importScripts('tab-rules.js');
try {
  importScripts('config.local.js');
} catch {
  // Personal config is optional.
}

const AUTO_GROUP_SETTINGS_KEY = 'tabOutAutoGroupSettings';
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
};

const pendingTabTimers = new Map();

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
    color: spec.color || 'grey',
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

  for (const [windowId, windowTabs] of tabsByWindow.entries()) {
    const groups = TAB_OUT_RULES.getDashboardGroups(windowTabs, {
      landingPagePatterns: typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : [],
      customGroups: typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [],
      semanticGroups: typeof LOCAL_SEMANTIC_GROUPS !== 'undefined' ? LOCAL_SEMANTIC_GROUPS : [],
    });
    for (const group of groups) {
      const spec = {
        key: group.domain,
        label: group.label || TAB_OUT_RULES.friendlyDomain(group.domain),
        color: group.color || 'grey',
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
      color: manualGroup.color || 'grey',
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
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAutoGroupSettings();
  await setupSidePanel();
  await updateBadge();

  const settings = await getAutoGroupSettings();
  if (settings.enabled && settings.groupExistingOnStartup) {
    await groupAllOpenTabs({ includeAlreadyGrouped: false });
  }
});

chrome.tabs.onCreated.addListener(tab => {
  updateBadge();
  scheduleTabGrouping(tab.id);
});

chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  updateBadge();
  if (changeInfo.url || changeInfo.status === 'complete') {
    scheduleTabGrouping(tabId);
  }
});

chrome.tabs.onAttached.addListener(tabId => {
  scheduleTabGrouping(tabId);
});

// ─── Initial run ─────────────────────────────────────────────────────────────

ensureAutoGroupSettings()
  .then(async settings => {
    await setupSidePanel();
    await updateBadge();
    if (settings.enabled && settings.groupExistingOnStartup) {
      await groupAllOpenTabs({ includeAlreadyGrouped: false });
    }
  })
  .catch(() => updateBadge());
