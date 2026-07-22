/* Shared tab grouping rules for Tab Out pages and the service worker. */
(function initTabOutRules(global) {
  'use strict';

  const UNGROUPED_TAB_ID = -1;
  const MANUAL_GROUPS_STORAGE_KEY = 'tabOutManualGroups';
  const RULE_SETTINGS_STORAGE_KEY = 'tabOutRuleSettings';
  const WORKSPACES_STORAGE_KEY = 'tabOutWorkspaces';
  const DEFAULT_RULE_ORDER = ['landing', 'custom', 'semantic'];

  const REAL_TAB_EXCLUDED_PREFIXES = [
    'about:',
    'blob:',
    'brave://',
    'chrome-extension://',
    'chrome-search://',
    'chrome://',
    'data:',
    'devtools://',
    'edge://',
    'filesystem:',
    'javascript:',
  ];

  const DEFAULT_LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (pathname, href) =>
        !href.includes('#inbox/') && !href.includes('#sent/') && !href.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
  ];

  // Compact semantic seeds, curated from public domain-category lists and
  // common productivity workflows. Keep this intentionally small; huge
  // blocklists make browser grouping noisy and slow.
  const DEFAULT_SEMANTIC_GROUPS = [
    {
      key: 'ai',
      label: 'AI',
      color: 'purple',
      sortOrder: 200,
      hostnames: [
        'aistudio.google.com',
        'bolt.new',
        'chat.openai.com',
        'chatgpt.com',
        'claude.ai',
        'code.claude.com',
        'copilot.microsoft.com',
        'gemini.google.com',
        'grok.com',
        'notebooklm.google.com',
        'poe.com',
        'qianwen.aliyun.com',
        'tongyi.aliyun.com',
        'v0.dev',
        'yuanbao.tencent.com',
      ],
      hostnameSuffixes: [
        'anthropic.com',
        'chatglm.cn',
        'cohere.ai',
        'cohere.com',
        'cursor.com',
        'cursor.sh',
        'deepseek.com',
        'dify.ai',
        'doubao.com',
        'elevenlabs.io',
        'huggingface.co',
        'kimi.com',
        'langchain.com',
        'lmstudio.ai',
        'lovable.dev',
        'midjourney.com',
        'mistral.ai',
        'ollama.com',
        'openai.com',
        'openrouter.ai',
        'perplexity.ai',
        'replicate.com',
        'runwayml.com',
        'windsurf.com',
        'x.ai',
        'zhipuai.cn',
      ],
    },
    {
      key: 'dev',
      label: 'Dev',
      color: 'cyan',
      sortOrder: 210,
      hostnames: [
        '0.0.0.0',
        '127.0.0.1',
        '[::1]',
        'developer.mozilla.org',
        'docs.github.com',
        'gist.github.com',
        'localhost',
        'pkg.go.dev',
      ],
      hostnameSuffixes: [
        'bitbucket.org',
        'cloudflare.com',
        'deno.com',
        'deno.land',
        'docker.com',
        'gitee.com',
        'github.com',
        'gitlab.com',
        'go.dev',
        'juejin.cn',
        'kubernetes.io',
        'netlify.com',
        'nodejs.org',
        'npmjs.com',
        'pypi.org',
        'python.org',
        'readthedocs.io',
        'rust-lang.org',
        'segmentfault.com',
        'sentry.io',
        'stackexchange.com',
        'stackoverflow.com',
        'supabase.com',
        'vercel.com',
        'v2ex.com',
      ],
    },
    {
      key: 'docs',
      label: 'Docs',
      color: 'blue',
      sortOrder: 220,
      hostnames: [
        'docs.google.com',
        'drive.google.com',
        'onedrive.live.com',
      ],
      hostnameSuffixes: [
        'airtable.com',
        'coda.io',
        'dropbox.com',
        'gitbook.io',
        'notion.site',
        'notion.so',
        'obsidian.md',
        'readwise.io',
        'sharepoint.com',
        'shimo.im',
        'yuque.com',
      ],
    },
    {
      key: 'work',
      label: 'Work',
      color: 'green',
      sortOrder: 230,
      hostnames: [
        'calendar.google.com',
        'mail.google.com',
        'meet.google.com',
        'outlook.live.com',
        'outlook.office.com',
        'teams.microsoft.com',
        'web.telegram.org',
        'work.weixin.qq.com',
      ],
      hostnameSuffixes: [
        'asana.com',
        'atlassian.net',
        'clickup.com',
        'dingtalk.com',
        'feishu.cn',
        'larksuite.com',
        'linear.app',
        'monday.com',
        'slack.com',
        'trello.com',
        'zoom.us',
      ],
    },
    {
      key: 'finance',
      label: 'Finance',
      color: 'yellow',
      sortOrder: 240,
      hostnameSuffixes: [
        'binance.com',
        'coinbase.com',
        'eastmoney.com',
        'futunn.com',
        'ibkr.com',
        'interactivebrokers.com',
        'kraken.com',
        'longbridge.com',
        'moomoo.com',
        'okx.com',
        'paypal.com',
        'schwab.com',
        'stripe.com',
        'tradingview.com',
        'wise.com',
        'xueqiu.com',
      ],
    },
    {
      key: 'reading',
      label: 'Reading',
      color: 'orange',
      sortOrder: 250,
      hostnames: [
        'news.ycombinator.com',
      ],
      hostnameSuffixes: [
        '36kr.com',
        'apnews.com',
        'arxiv.org',
        'bbc.com',
        'bloomberg.com',
        'cnn.com',
        'economist.com',
        'ft.com',
        'infoq.cn',
        'infoq.com',
        'ithome.com',
        'medium.com',
        'nytimes.com',
        'reuters.com',
        'sspai.com',
        'substack.com',
        'techcrunch.com',
        'theverge.com',
        'wikipedia.org',
        'wsj.com',
      ],
    },
    {
      key: 'social',
      label: 'Social',
      color: 'pink',
      sortOrder: 260,
      hostnameSuffixes: [
        'bsky.app',
        'facebook.com',
        'instagram.com',
        'linkedin.com',
        'mastodon.social',
        'reddit.com',
        't.me',
        'telegram.org',
        'threads.net',
        'twitter.com',
        'weibo.com',
        'x.com',
        'xiaohongshu.com',
        'zhihu.com',
      ],
    },
    {
      key: 'video',
      label: 'Video',
      color: 'red',
      sortOrder: 270,
      hostnames: [
        'music.youtube.com',
        'open.spotify.com',
        'podcasts.apple.com',
      ],
      hostnameSuffixes: [
        'bilibili.com',
        'douyin.com',
        'iqiyi.com',
        'netflix.com',
        'soundcloud.com',
        'spotify.com',
        'twitch.tv',
        'vimeo.com',
        'youku.com',
        'youtu.be',
        'youtube.com',
      ],
    },
    {
      key: 'shopping',
      label: 'Shopping',
      color: 'orange',
      sortOrder: 280,
      hostnameSuffixes: [
        'airbnb.com',
        'amazon.com',
        'bestbuy.com',
        'booking.com',
        'costco.com',
        'ebay.com',
        'etsy.com',
        'ikea.com',
        'jd.com',
        'pinduoduo.com',
        'shopify.com',
        'taobao.com',
        'target.com',
        'tmall.com',
        'walmart.com',
      ],
    },
  ];

  const FRIENDLY_DOMAINS = {
    'arxiv.org': 'arXiv',
    'calendar.google.com': 'Google Calendar',
    'chat.openai.com': 'ChatGPT',
    'chatgpt.com': 'ChatGPT',
    'claude.ai': 'Claude',
    'code.claude.com': 'Claude Code',
    'developer.mozilla.org': 'MDN',
    'docs.google.com': 'Google Docs',
    'drive.google.com': 'Google Drive',
    'figma.com': 'Figma',
    'fund.eastmoney.com': 'Eastmoney',
    'gemini.google.com': 'Gemini',
    'github.com': 'GitHub',
    'gist.github.com': 'GitHub Gist',
    'local-files': 'Local Files',
    'mail.google.com': 'Gmail',
    'meet.google.com': 'Google Meet',
    'music.youtube.com': 'YouTube Music',
    'news.ycombinator.com': 'Hacker News',
    'notion.so': 'Notion',
    'npmjs.com': 'npm',
    'open.spotify.com': 'Spotify',
    'stackoverflow.com': 'Stack Overflow',
    'www.youtube.com': 'YouTube',
    'x.com': 'X',
    'youtube.com': 'YouTube',
  };

  function normalizeHostname(hostname) {
    return (hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function isRealTabUrl(url) {
    if (!url) return false;
    return !REAL_TAB_EXCLUDED_PREFIXES.some(prefix => url.startsWith(prefix));
  }

  function parseTabUrl(url) {
    try { return new URL(url); }
    catch { return null; }
  }

  function toList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function normalizePathPrefix(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
  }

  function hostnameEndsWithSuffix(hostname, suffix) {
    const normalized = normalizeHostname(hostname);
    const normalizedSuffix = normalizeHostname(suffix).replace(/^\./, '');
    return normalized === normalizedSuffix || normalized.endsWith('.' + normalizedSuffix);
  }

  function hostnameMatchesPattern(hostname, pattern) {
    const normalized = normalizeHostname(hostname);
    const hostnames = toList(pattern.hostname).concat(toList(pattern.hostnames)).map(normalizeHostname);
    if (hostnames.includes(normalized)) return true;
    return toList(pattern.hostnameEndsWith).concat(toList(pattern.hostnameSuffixes))
      .some(suffix => hostnameEndsWithSuffix(normalized, suffix));
  }

  function patternMatchesUrl(pattern, parsed, href) {
    const hostnameMatch = hostnameMatchesPattern(parsed.hostname, pattern);
    if (!hostnameMatch) return false;
    if (pattern.test) return pattern.test(parsed.pathname, href);
    if (pattern.pathPrefix) return toList(pattern.pathPrefix).some(prefix => parsed.pathname.startsWith(prefix));
    if (pattern.pathExact) return toList(pattern.pathExact).includes(parsed.pathname);
    return parsed.pathname === '/';
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function friendlyDomain(hostname) {
    const normalized = normalizeHostname(hostname);
    if (!normalized) return '';
    if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];
    if (FRIENDLY_DOMAINS[normalized]) return FRIENDLY_DOMAINS[normalized];

    if (normalized.endsWith('.substack.com') && normalized !== 'substack.com') {
      return capitalize(normalized.replace('.substack.com', '')) + "'s Substack";
    }
    if (normalized.endsWith('.github.io')) {
      return capitalize(normalized.replace('.github.io', '')) + ' (GitHub Pages)';
    }

    const clean = normalized.replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp|cn)$/, '');
    return clean.split('.').map(capitalize).join(' ');
  }

  function colorFromString(value) {
    const colors = ['grey', 'blue', 'green', 'yellow', 'purple', 'cyan', 'orange', 'pink'];
    let hash = 0;
    for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  function normalizeRuleOrder(rawOrder) {
    const allowed = new Set(DEFAULT_RULE_ORDER);
    const order = [];
    for (const item of rawOrder || []) {
      if (allowed.has(item) && !order.includes(item)) order.push(item);
    }
    for (const item of DEFAULT_RULE_ORDER) {
      if (!order.includes(item)) order.push(item);
    }
    return order;
  }

  function normalizeRuleSettings(rawSettings) {
    const raw = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const customGroups = [];
    const seenIds = new Set();

    for (const rule of raw.customGroups || []) {
      if (!rule) continue;
      const groupLabel = String(rule.groupLabel || rule.label || rule.name || '').trim().slice(0, 40);
      const id = String(rule.id || rule.groupKey || groupLabel || Date.now()).trim();
      if (!id || !groupLabel || seenIds.has(id)) continue;

      const normalizedRule = {
        id,
        groupKey: rule.groupKey || 'rule:' + id,
        groupLabel,
        color: rule.color || colorFromString(groupLabel),
        sortOrder: typeof rule.sortOrder === 'number' ? rule.sortOrder : customGroups.length,
        createdAt: rule.createdAt || new Date().toISOString(),
        updatedAt: rule.updatedAt || rule.createdAt || new Date().toISOString(),
      };

      if (rule.hostname) normalizedRule.hostname = normalizeHostname(rule.hostname);
      if (rule.hostnameEndsWith) normalizedRule.hostnameEndsWith = normalizeHostname(rule.hostnameEndsWith).replace(/^\./, '');
      if (rule.hostnameSuffixes) normalizedRule.hostnameSuffixes = toList(rule.hostnameSuffixes)
        .map(suffix => normalizeHostname(suffix).replace(/^\./, ''))
        .filter(Boolean);
      if (rule.hostnames) normalizedRule.hostnames = toList(rule.hostnames).map(normalizeHostname).filter(Boolean);
      if (rule.pathPrefix) {
        const prefixes = toList(rule.pathPrefix).map(normalizePathPrefix).filter(Boolean);
        if (prefixes.length === 1) normalizedRule.pathPrefix = prefixes[0];
        else if (prefixes.length > 1) normalizedRule.pathPrefix = prefixes;
      }
      if (rule.pathExact) normalizedRule.pathExact = rule.pathExact;

      if (
        normalizedRule.hostname ||
        normalizedRule.hostnameEndsWith ||
        normalizedRule.hostnameSuffixes ||
        normalizedRule.hostnames
      ) {
        seenIds.add(id);
        customGroups.push(normalizedRule);
      }
    }

    return {
      ruleOrder: normalizeRuleOrder(raw.ruleOrder),
      customGroups,
    };
  }

  function normalizeWorkspacesState(rawState) {
    const raw = rawState && typeof rawState === 'object' ? rawState : {};
    const workspaces = [];
    const seenIds = new Set();

    for (const workspace of raw.workspaces || []) {
      if (!workspace || !workspace.id || !workspace.name || seenIds.has(String(workspace.id))) continue;
      const tabs = [];
      const seenUrls = new Set();
      for (const tab of workspace.tabs || []) {
        if (!tab || !tab.url || seenUrls.has(tab.url)) continue;
        seenUrls.add(tab.url);
        tabs.push({
          url: tab.url,
          title: tab.title || tab.url,
          savedAt: tab.savedAt || workspace.createdAt || new Date().toISOString(),
        });
      }
      if (tabs.length === 0) continue;
      const id = String(workspace.id);
      seenIds.add(id);
      workspaces.push({
        id,
        name: String(workspace.name).trim().slice(0, 48),
        tabs,
        createdAt: workspace.createdAt || new Date().toISOString(),
        updatedAt: workspace.updatedAt || workspace.createdAt || new Date().toISOString(),
      });
    }

    return { workspaces };
  }

  function normalizeManualGroupsState(rawState) {
    const raw = rawState && typeof rawState === 'object' ? rawState : {};
    const seenIds = new Set();
    const groups = [];

    for (const group of raw.groups || []) {
      if (!group || !group.id || !group.name) continue;
      const id = String(group.id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      groups.push({
        id,
        name: String(group.name).trim().slice(0, 40),
        color: group.color || colorFromString(group.name),
        createdAt: group.createdAt || new Date().toISOString(),
        updatedAt: group.updatedAt || group.createdAt || new Date().toISOString(),
      });
    }

    const assignments = {};
    const validIds = new Set(groups.map(group => group.id));
    const rawAssignments = raw.assignments && typeof raw.assignments === 'object'
      ? raw.assignments
      : {};

    for (const [url, groupId] of Object.entries(rawAssignments)) {
      if (!url || !validIds.has(groupId)) continue;
      assignments[url] = groupId;
    }

    return { groups, assignments };
  }

  function getManualGroupIdForUrl(url, manualGroupsState) {
    const state = normalizeManualGroupsState(manualGroupsState);
    const groupId = state.assignments[url];
    if (!groupId) return '';
    return state.groups.some(group => group.id === groupId) ? groupId : '';
  }

  function isManualGroupedTab(tabOrUrl, manualGroupsState) {
    const url = typeof tabOrUrl === 'string'
      ? tabOrUrl
      : tabOrUrl && tabOrUrl.url;
    return !!getManualGroupIdForUrl(url, manualGroupsState);
  }

  function getManualDashboardGroups(tabs, manualGroupsState) {
    const state = normalizeManualGroupsState(manualGroupsState);
    const groupsById = new Map(state.groups.map(group => [
      group.id,
      {
        domain: 'manual:' + group.id,
        label: group.name,
        color: group.color,
        isManual: true,
        sortOrder: 50,
        tabs: [],
      },
    ]));

    for (const tab of tabs || []) {
      const groupId = getManualGroupIdForUrl(tab && tab.url, state);
      if (!groupId || !groupsById.has(groupId)) continue;
      groupsById.get(groupId).tabs.push(tab);
    }

    return Array.from(groupsById.values()).filter(group => group.tabs.length > 0);
  }

  function getTabGroupSpec(tab) {
    if (!tab || tab.pinned || !isRealTabUrl(tab.url)) return null;

    const parsed = parseTabUrl(tab.url);
    const hostname = tab.url.startsWith('file://')
      ? 'local-files'
      : parsed && parsed.hostname;
    if (!hostname) return null;

    return {
      key: hostname,
      label: friendlyDomain(hostname),
      color: colorFromString(hostname),
    };
  }

  function getLandingPatterns(extraPatterns) {
    return DEFAULT_LANDING_PAGE_PATTERNS.concat(extraPatterns || []);
  }

  function getSemanticGroups(extraGroups) {
    return DEFAULT_SEMANTIC_GROUPS.concat(extraGroups || []);
  }

  function isLandingPage(url, extraPatterns) {
    const parsed = parseTabUrl(url);
    if (!parsed) return false;
    return getLandingPatterns(extraPatterns).some(pattern => patternMatchesUrl(pattern, parsed, url));
  }

  function matchCustomGroup(url, customGroups) {
    const parsed = parseTabUrl(url);
    if (!parsed) return null;
    return (customGroups || []).find(rule => {
      const hostMatch = hostnameMatchesPattern(parsed.hostname, rule);
      if (!hostMatch) return false;
      if (rule.pathPrefix) return toList(rule.pathPrefix).some(prefix => parsed.pathname.startsWith(prefix));
      if (rule.pathExact) return toList(rule.pathExact).includes(parsed.pathname);
      return true;
    }) || null;
  }

  function semanticKey(rule) {
    const rawKey = rule.groupKey || rule.key || rule.label || 'group';
    return 'semantic:' + String(rawKey).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function matchSemanticGroup(url, semanticGroups) {
    const parsed = parseTabUrl(url);
    if (!parsed) return null;

    return getSemanticGroups(semanticGroups).find(rule => {
      if (!hostnameMatchesPattern(parsed.hostname, rule)) return false;
      if (rule.pathPrefix) return toList(rule.pathPrefix).some(prefix => parsed.pathname.startsWith(prefix));
      if (rule.pathExact) return toList(rule.pathExact).includes(parsed.pathname);
      if (rule.test) return rule.test(parsed.pathname, url);
      return true;
    }) || null;
  }

  function ruleOrderBase(ruleOrder, type, fallback) {
    const normalizedOrder = normalizeRuleOrder(ruleOrder);
    const index = normalizedOrder.indexOf(type);
    return index === -1 ? fallback : index * 100;
  }

  function addGroupedTab(groupMap, key, group, tab) {
    if (!groupMap[key]) groupMap[key] = { ...group, tabs: [] };
    groupMap[key].tabs.push(tab);
  }

  function getDashboardGroups(tabs, options) {
    const groupMap = {};
    const landingPatterns = getLandingPatterns(options && options.landingPagePatterns);
    const customGroups = options && options.customGroups ? options.customGroups : [];
    const semanticGroups = options && options.semanticGroups ? options.semanticGroups : [];
    const ruleOrder = normalizeRuleOrder(options && options.ruleOrder);

    for (const tab of tabs || []) {
      try {
        if (!isRealTabUrl(tab.url)) continue;

        let grouped = false;
        for (const ruleType of ruleOrder) {
          if (ruleType === 'landing' && isLandingPage(tab.url, options && options.landingPagePatterns)) {
            addGroupedTab(groupMap, '__landing-pages__', {
              domain: '__landing-pages__',
              label: 'Home pages',
              color: 'yellow',
              sortOrder: ruleOrderBase(ruleOrder, 'landing', 0),
            }, tab);
            grouped = true;
            break;
          }

          if (ruleType === 'custom') {
            const customRule = matchCustomGroup(tab.url, customGroups);
            if (customRule) {
              const key = customRule.groupKey;
              addGroupedTab(groupMap, key, {
                domain: key,
                label: customRule.groupLabel,
                color: customRule.color || colorFromString(key),
                isCustom: true,
                sortOrder: ruleOrderBase(ruleOrder, 'custom', 100) + ((customRule.sortOrder || 0) / 1000),
              }, tab);
              grouped = true;
              break;
            }
          }

          if (ruleType === 'semantic') {
            const semanticRule = matchSemanticGroup(tab.url, semanticGroups);
            if (semanticRule) {
              const key = semanticKey(semanticRule);
              addGroupedTab(groupMap, key, {
                domain: key,
                label: semanticRule.groupLabel || semanticRule.label,
                color: semanticRule.color || colorFromString(key),
                isSemantic: true,
                sortOrder: ruleOrderBase(ruleOrder, 'semantic', 500) + ((semanticRule.sortOrder || 0) / 1000),
              }, tab);
              grouped = true;
              break;
            }
          }
        }
        if (grouped) continue;

        const spec = getTabGroupSpec(tab);
        if (!spec) continue;
        if (!groupMap[spec.key]) groupMap[spec.key] = { domain: spec.key, label: spec.label, color: spec.color, sortOrder: 1000, tabs: [] };
        groupMap[spec.key].tabs.push(tab);
      } catch {
        // Skip malformed or inaccessible URLs.
      }
    }

    const landingHostnames = new Set(landingPatterns.map(pattern => pattern.hostname).filter(Boolean));
    const landingSuffixes = landingPatterns.map(pattern => pattern.hostnameEndsWith).filter(Boolean);
    function isLandingDomain(domain) {
      if (landingHostnames.has(domain)) return true;
      return landingSuffixes.some(suffix => domain.endsWith(suffix));
    }

    return Object.values(groupMap).sort((a, b) => {
      const aIsLanding = a.domain === '__landing-pages__';
      const bIsLanding = b.domain === '__landing-pages__';
      if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

      const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : 1000;
      const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : 1000;
      if (aOrder !== bOrder) return aOrder - bOrder;

      const aIsPriority = isLandingDomain(a.domain);
      const bIsPriority = isLandingDomain(b.domain);
      if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

      return b.tabs.length - a.tabs.length;
    });
  }

  global.TAB_OUT_RULES = {
    UNGROUPED_TAB_ID,
    MANUAL_GROUPS_STORAGE_KEY,
    RULE_SETTINGS_STORAGE_KEY,
    WORKSPACES_STORAGE_KEY,
    DEFAULT_RULE_ORDER,
    DEFAULT_LANDING_PAGE_PATTERNS,
    DEFAULT_SEMANTIC_GROUPS,
    REAL_TAB_EXCLUDED_PREFIXES,
    colorFromString,
    friendlyDomain,
    getDashboardGroups,
    getManualDashboardGroups,
    getManualGroupIdForUrl,
    getTabGroupSpec,
    hostnameMatchesPattern,
    isRealTabUrl,
    isManualGroupedTab,
    matchSemanticGroup,
    normalizeHostname,
    normalizeManualGroupsState,
    normalizeRuleSettings,
    normalizeWorkspacesState,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
