import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(root, 'extension');
const optionalLocalFiles = new Set(['config.local.js']);

function fail(message) {
  console.error(`validation failed: ${message}`);
  process.exitCode = 1;
}

function requireFile(relativePath, context) {
  if (!relativePath || optionalLocalFiles.has(relativePath)) return;
  const absolutePath = path.join(extensionRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`${context} references missing file ${relativePath}`);
  }
}

const jsFiles = fs.readdirSync(extensionRoot)
  .filter((name) => name.endsWith('.js') && !optionalLocalFiles.has(name))
  .sort();

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(extensionRoot, file)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail(`${file} has invalid JavaScript syntax\n${result.stderr}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!manifest.name || !manifest.version) fail('manifest must include name and version');

requireFile(manifest.background?.service_worker, 'manifest background');
requireFile(manifest.chrome_url_overrides?.newtab, 'manifest new-tab override');
requireFile(manifest.side_panel?.default_path, 'manifest side panel');
for (const icon of Object.values(manifest.icons || {})) requireFile(icon, 'manifest icons');
for (const icon of Object.values(manifest.action?.default_icon || {})) requireFile(icon, 'manifest action icons');

const html = fs.readFileSync(path.join(extensionRoot, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const reference = match[1].split(/[?#]/, 1)[0];
  if (!reference || /^(?:https?:|data:|chrome:|#)/.test(reference)) continue;
  requireFile(reference, 'index.html');
}

const rulesContext = { console };
vm.createContext(rulesContext);
vm.runInContext(fs.readFileSync(path.join(extensionRoot, 'tab-rules.js'), 'utf8'), rulesContext);
const rules = rulesContext.TAB_OUT_RULES;
if (!rules) fail('tab-rules.js must expose TAB_OUT_RULES');
for (const exportName of ['getDashboardGroups', 'normalizeManualGroupsState', 'normalizeRuleSettings', 'normalizeWorkspacesState']) {
  if (typeof rules?.[exportName] !== 'function') fail(`TAB_OUT_RULES.${exportName} must be a function`);
}

const normalizedSettings = rules?.normalizeRuleSettings?.({});
if (!Array.isArray(normalizedSettings?.ruleOrder) || normalizedSettings.ruleOrder.length === 0) {
  fail('default rule order must be non-empty');
}

if (!process.exitCode) {
  console.log(`validated ${jsFiles.length} JavaScript files, manifest references, HTML assets, and rule exports`);
}
