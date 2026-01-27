import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

function normalizeVersionArg(arg) {
  const s = String(arg || '').trim();
  const noPrefix = s.replace(/^v/i, '');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(noPrefix)) {
    throw new Error(`Invalid version: ${s}`);
  }
  return noPrefix;
}

function writeIfChanged(filePath, next) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (prev === next) return false;
  fs.writeFileSync(filePath, next, 'utf8');
  return true;
}

function updatePackageJson(version) {
  const pkgPath = path.join(cwd, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.version = version;
  const next = `${JSON.stringify(pkg, null, 2)}\n`;
  return writeIfChanged(pkgPath, next);
}

function replaceOnce(input, pattern, replacement) {
  const before = String(input);
  const after = before.replace(pattern, replacement);
  return { changed: before !== after, text: after };
}

function updateAboutHtml(version) {
  const p = path.join(cwd, 'src', 'about.html');
  const raw = fs.readFileSync(p, 'utf8');
  const pattern = /(<div\s+class="info-label">\s*)([^<]+)(\s*<\/div>)/;
  const m = raw.match(pattern);
  if (!m) throw new Error('Failed to locate version in src/about.html');
  if (String(m[2]).trim() === version) return false;
  const r = replaceOnce(raw, pattern, `$1${version}$3`);
  return writeIfChanged(p, r.text);
}

function updateSettingsHtml(version) {
  const p = path.join(cwd, 'src', 'settings.html');
  const raw = fs.readFileSync(p, 'utf8');
  const pattern = /(<div\s+style="[^"]*color:\s*var\(--text-medium\);[^"]*">\s*)([^<]+)(\s*<\/div>)/;
  const m = raw.match(pattern);
  if (!m) throw new Error('Failed to locate version in src/settings.html');
  if (String(m[2]).trim() === version) return false;
  const r = replaceOnce(raw, pattern, `$1${version}$3`);
  return writeIfChanged(p, r.text);
}

const version = normalizeVersionArg(process.argv[2]);

updatePackageJson(version);
updateAboutHtml(version);
updateSettingsHtml(version);
