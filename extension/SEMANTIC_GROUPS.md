# Semantic Groups

Tab Out uses a compact built-in semantic layer before falling back to
per-domain grouping.

Current order:

1. `Homepages`
2. `LOCAL_CUSTOM_GROUPS` from `config.local.js`
3. built-in semantic groups such as `AI`, `Dev`, `Docs`, `Work`, `Finance`
4. per-domain groups

Reference sources checked:

- `v2fly/domain-list-community`: permissive MIT license, useful category seeds
  such as `category-ai-!cn`, `category-dev`, `category-finance`,
  `category-media`, and `category-social-media-!cn`.
- UT1 blacklists: very broad category coverage, but optimized for filtering
  and blocklists. It is useful as a reference, not as a full in-extension import.

The extension intentionally does not vendor full public lists. Large blocklists
contain lots of security, ad, adult, regional, and infrastructure categories
that make tab grouping noisy. Keep the built-in list small and add personal
rules through `LOCAL_SEMANTIC_GROUPS` when needed.

Example local override:

```js
const LOCAL_SEMANTIC_GROUPS = [
  {
    key: 'research',
    label: 'Research',
    color: 'blue',
    sortOrder: 205,
    hostnameSuffixes: ['semanticscholar.org', 'paperswithcode.com'],
  },
];
```
