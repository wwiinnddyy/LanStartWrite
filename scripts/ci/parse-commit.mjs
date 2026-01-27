import fs from 'node:fs';

function setOutput(key, value) {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) return;
  fs.appendFileSync(outPath, `${key}<<__EOF__\n${String(value ?? '')}\n__EOF__\n`);
}

function normalizeVersion(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const noPrefix = s.replace(/^v/i, '');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(noPrefix)) return '';
  return noPrefix;
}

function parseBuildMode(message) {
  const m = String(message || '');
  const tokens = (m.match(/\bbuild:[a-z0-9_-]+\b/gi) || []).map(s => s.toLowerCase());
  const has = (t) => tokens.includes(`build:${t}`);

  if (has('all') || has('win')) return 'all';

  const wantInstaller = has('installer') || has('nsis');
  const wantPortable = has('portable');

  if (wantInstaller && wantPortable) return 'all';
  if (wantInstaller) return 'installer';
  if (wantPortable) return 'portable';
  return '';
}

const message = String(process.env.RELEASE_MESSAGE || '').trim();
const version = normalizeVersion((message.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/) || [])[1]);
const tag = version ? `v${version}` : '';

let buildMode = parseBuildMode(message);
if (!buildMode && version) buildMode = 'all';

let buildScript = '';
if (buildMode === 'installer') buildScript = 'pnpm -s build:installer';
if (buildMode === 'portable') buildScript = 'pnpm -s build:portable';
if (buildMode === 'all') buildScript = 'pnpm -s build:all';

setOutput('version', version);
setOutput('tag', tag);
setOutput('build_script', buildScript);
setOutput('run_win', buildScript ? 'true' : 'false');
