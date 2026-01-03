const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const yauzl = require('yauzl');
const semver = require('semver');

const _RUN_TESTS = process.argv.includes('--run-tests');

let _testsTimeout = null;

let mainWindow;
let _overlayInteractiveRects = [];
let _overlayIgnoreConfig = { ignore: false, forward: false };
let _overlayLastApplied = null;
let _overlayPollTimer = null;

let _modWatcher = null;
let _modRegistryWatcher = null;

function _applyIgnoreMouse(ignore, forward) {
  if (!mainWindow) return;
  const key = `${ignore ? 1 : 0}:${forward ? 1 : 0}`;
  if (_overlayLastApplied === key) return;
  _overlayLastApplied = key;
  if (ignore) mainWindow.setIgnoreMouseEvents(true, { forward: !!forward });
  else mainWindow.setIgnoreMouseEvents(false);
}

function _shouldAllowOverlayInteraction() {
  if (!mainWindow) return false;
  const rects = Array.isArray(_overlayInteractiveRects) ? _overlayInteractiveRects : [];
  if (rects.length === 0) return false;
  const winBounds = mainWindow.getBounds();
  const p = screen.getCursorScreenPoint();
  const px = p.x;
  const py = p.y;
  for (const r of rects) {
    const left = winBounds.x + (Number(r.left) || 0);
    const top = winBounds.y + (Number(r.top) || 0);
    const width = Number(r.width) || 0;
    const height = Number(r.height) || 0;
    if (width <= 0 || height <= 0) continue;
    const right = left + width;
    const bottom = top + height;
    if (px >= left && px <= right && py >= top && py <= bottom) return true;
  }
  return false;
}

function _ensureOverlayPoll() {
  if (_overlayPollTimer) return;
  _overlayPollTimer = setInterval(() => {
    try {
      if (!_overlayIgnoreConfig.ignore) return;
      if (!_overlayIgnoreConfig.forward) return;
      if (!mainWindow) return;
      const allow = _shouldAllowOverlayInteraction();
      if (allow) _applyIgnoreMouse(false, false);
      else _applyIgnoreMouse(true, true);
    } catch (e) {}
  }, 10);
}

function _stopOverlayPoll() {
  if (!_overlayPollTimer) return;
  try { clearInterval(_overlayPollTimer); } catch (e) {}
  _overlayPollTimer = null;
}

function createWindow(opts) {
  const runTests = !!(opts && opts.runTests);
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: !runTests,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (runTests) mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { runTests: '1' } });
  else mainWindow.loadFile(path.join(__dirname, 'index.html'));
  try{ mainWindow.setAlwaysOnTop(true, 'screen-saver'); }catch(e){}
  try{ mainWindow.maximize(); }catch(e){}
  
  // 开发时打开开发者工具
  // mainWindow.webContents.openDevTools();
}

function _broadcast(channel, data) {
  try {
    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send(channel, data);
  } catch (e) {}
}

function _nowId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function _getModRoot() {
  const envRoot = process.env.LANSTART_MOD_ROOT;
  if (envRoot && typeof envRoot === 'string') return envRoot;
  try {
    const appPath = app.getAppPath();
    const candidate = path.join(appPath, 'mod');
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch (e) {}
  } catch (e) {}
  return path.join(app.getPath('userData'), 'mod');
}

function _getModPaths() {
  const root = _getModRoot();
  return {
    root,
    pluginsDir: path.join(root, 'plugins'),
    tempDir: path.join(root, 'temp'),
    configDir: path.join(root, 'config'),
    registryPath: path.join(root, 'config', 'registry.json'),
    trustPath: path.join(root, 'config', 'trust.json')
  };
}

async function _ensureModDirs() {
  const p = _getModPaths();
  await fs.promises.mkdir(p.pluginsDir, { recursive: true });
  await fs.promises.mkdir(p.tempDir, { recursive: true });
  await fs.promises.mkdir(p.configDir, { recursive: true });
  return p;
}

async function _readJson(filePath, fallback) {
  try {
    const txt = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return fallback;
  }
}

async function _writeJsonAtomic(filePath, obj) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${_nowId()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.promises.rename(tmp, filePath);
}

function _isSafeRelPath(rel) {
  if (!rel || typeof rel !== 'string') return false;
  if (rel.includes('\0')) return false;
  const n = rel.replace(/\\/g, '/');
  if (n.startsWith('/') || n.includes('..')) return false;
  return true;
}

function _sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (buf) => h.update(buf));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function _openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      resolve(zipfile);
    });
  });
}

async function _extractZip(zipPath, destDir) {
  await fs.promises.mkdir(destDir, { recursive: true });
  const zip = await _openZip(zipPath);
  const extracted = [];
  await new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', (entry) => {
      const fileName = entry.fileName;
      const isDir = /\/$/.test(fileName);
      if (!_isSafeRelPath(fileName)) {
        zip.close();
        reject(new Error('unsafe entry path'));
        return;
      }
      const outPath = path.join(destDir, fileName);
      if (isDir) {
        fs.mkdir(outPath, { recursive: true }, (e) => {
          if (e) return reject(e);
          zip.readEntry();
        });
        return;
      }
      fs.mkdir(path.dirname(outPath), { recursive: true }, (e) => {
        if (e) return reject(e);
        zip.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          const writeStream = fs.createWriteStream(outPath);
          readStream.on('error', reject);
          writeStream.on('error', reject);
          writeStream.on('close', () => {
            extracted.push(fileName);
            zip.readEntry();
          });
          readStream.pipe(writeStream);
        });
      });
    });
    zip.on('end', resolve);
    zip.on('error', reject);
  });
  try { zip.close(); } catch (e) {}
  return extracted;
}

function _validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('invalid manifest');
  if (manifest.schemaVersion !== 1) throw new Error('unsupported schemaVersion');
  const id = String(manifest.id || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(id)) throw new Error('invalid id');
  const ver = String(manifest.version || '').trim();
  if (!semver.valid(ver)) throw new Error('invalid version');
  const type = String(manifest.type || '').trim();
  if (!['control-replace', 'mode', 'feature'].includes(type)) throw new Error('invalid type');
  const allowedPerms = new Set(['ui:toolbar', 'ui:mode', 'ui:overlay', 'ui:override', 'bus:cross', 'net:fetch']);
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.map(String).filter((x) => allowedPerms.has(x)) : [];
  const dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  const entry = manifest.entry && typeof manifest.entry === 'object' ? manifest.entry : {};
  const overrides = (manifest.overrides && typeof manifest.overrides === 'object') ? manifest.overrides : null;

  const entryKind = String(entry.kind || '').trim();
  const entryPath = String(entry.path || '').trim();
  if (entryKind) {
    if (entryKind !== 'worker') throw new Error('invalid entry kind');
    if (!entryPath || !_isSafeRelPath(entryPath)) throw new Error('invalid entry path');
  }

  for (const dep of dependencies) {
    if (!dep || typeof dep !== 'object') throw new Error('invalid dependency');
    const depId = String(dep.id || '').trim();
    const range = String(dep.version || '').trim();
    const optional = !!dep.optional;
    if (!depId || !/^[a-zA-Z0-9._-]{3,80}$/.test(depId)) { if (optional) continue; throw new Error('invalid dependency id'); }
    if (!range) { if (optional) continue; throw new Error('invalid dependency version'); }
  }

  for (const r of resources) {
    if (!r || typeof r !== 'object') throw new Error('invalid resource');
    const rp = String(r.path || '').trim();
    if (!rp || !_isSafeRelPath(rp)) throw new Error('invalid resource path');
    const rh = String(r.sha256 || '').trim();
    if (!/^[a-fA-F0-9]{64}$/.test(rh)) throw new Error('invalid resource hash');
    const rs = Number(r.size || 0);
    if (!Number.isFinite(rs) || rs < 0) throw new Error('invalid resource size');
  }

  if (overrides) {
    if (type !== 'control-replace') throw new Error('overrides require control-replace type');
    if (!permissions.includes('ui:override')) throw new Error('missing ui:override permission');
    const allow = new Set(['./tool_ui.html', './more_decide_ui.html', './setting_ui.html']);
    for (const k of Object.keys(overrides)) {
      if (!allow.has(k)) throw new Error('invalid override key');
      const rel = String(overrides[k] || '').trim();
      if (!rel || !_isSafeRelPath(rel)) throw new Error('invalid override path');
    }
  }

  return { id, version: ver, type, permissions, dependencies, resources, entry, overrides };
}

async function _loadRegistry() {
  const p = await _ensureModDirs();
  const fallback = { schemaVersion: 1, plugins: {}, order: [] };
  const reg = await _readJson(p.registryPath, fallback);
  if (!reg || reg.schemaVersion !== 1 || typeof reg !== 'object') return fallback;
  if (!reg.plugins || typeof reg.plugins !== 'object') reg.plugins = {};
  if (!Array.isArray(reg.order)) reg.order = [];
  return reg;
}

async function _saveRegistry(reg) {
  const p = await _ensureModDirs();
  await _writeJsonAtomic(p.registryPath, reg);
}

async function _listInstalled() {
  const p = await _ensureModDirs();
  const reg = await _loadRegistry();
  const entries = await fs.promises.readdir(p.pluginsDir, { withFileTypes: true });
  const installed = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    const manifestPath = path.join(p.pluginsDir, id, 'manifest.json');
    const manifest = await _readJson(manifestPath, null);
    if (!manifest) continue;
    let parsed = null;
    try { parsed = _validateManifest(manifest); } catch (e) { continue; }
    const enabled = !!(reg.plugins && reg.plugins[id] && reg.plugins[id].enabled);
    const regEntry = (reg.plugins && reg.plugins[id] && typeof reg.plugins[id] === 'object') ? reg.plugins[id] : {};
    const meta = {
      installedAt: Number(regEntry.installedAt || 0) || 0,
      signature: (regEntry.signature && typeof regEntry.signature === 'object') ? regEntry.signature : null
    };
    installed.push({ id, enabled, manifest: Object.assign({}, manifest, { id: parsed.id, version: parsed.version }), meta });
  }
  const order = Array.isArray(reg.order) ? reg.order : [];
  installed.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia === -1 && ib === -1) return a.id.localeCompare(b.id);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return { modRoot: p.root, installed };
}

function _collectOverrideConflicts(installed) {
  const owners = new Map();
  for (const pl of installed) {
    const m = pl && pl.manifest;
    if (!m || !pl.enabled) continue;
    const overrides = (m.overrides && typeof m.overrides === 'object') ? m.overrides : null;
    if (!overrides) continue;
    for (const k of Object.keys(overrides)) {
      if (!owners.has(k)) owners.set(k, pl.id);
      else return { key: k, a: owners.get(k), b: pl.id };
    }
  }
  return null;
}

function _findOverrideOwner(installed, key, exceptId) {
  const k = String(key || '').trim();
  for (const pl of installed) {
    if (!pl || !pl.enabled) continue;
    if (exceptId && pl.id === exceptId) continue;
    const m = pl.manifest;
    const o = m && m.overrides && typeof m.overrides === 'object' ? m.overrides : null;
    if (o && Object.prototype.hasOwnProperty.call(o, k)) return pl.id;
  }
  return null;
}

async function _getTrustedKeys() {
  const p = await _ensureModDirs();
  const trust = await _readJson(p.trustPath, null);
  const builtIn = [];
  const envKey = process.env.LANSTART_MOD_PUBKEY_PEM;
  if (envKey && typeof envKey === 'string') builtIn.push(envKey);
  const keys = [];
  if (trust && Array.isArray(trust.keys)) {
    for (const k of trust.keys) if (k && typeof k.pem === 'string') keys.push(k.pem);
  }
  for (const k of builtIn) keys.push(k);
  return keys.filter(Boolean);
}

async function _verifyLanmodSignature(workDir, manifestBuf, resources, allowUnsigned) {
  const sigPath = path.join(workDir, 'signature.sig');
  let sigRaw = null;
  try { sigRaw = await fs.promises.readFile(sigPath, 'utf8'); } catch (e) {}
  if (!sigRaw) {
    if (allowUnsigned) return { verified: false, reason: 'unsigned' };
    throw new Error('missing signature');
  }
  const sig = Buffer.from(String(sigRaw).trim(), 'base64');
  if (!sig || sig.length < 32) throw new Error('invalid signature');
  const manifestSha = crypto.createHash('sha256').update(manifestBuf).digest('hex');
  const lines = [];
  const list = Array.isArray(resources) ? resources.slice() : [];
  list.sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
  for (const r of list) {
    const rp = String(r && r.path || '');
    const rh = String(r && r.sha256 || '');
    const rs = Number(r && r.size || 0);
    lines.push(`${rh} ${rs} ${rp}`);
  }
  const payload = `LanmodSigV1\n${manifestSha}\n${lines.join('\n')}\n`;
  const keys = await _getTrustedKeys();
  const algos = [null, 'RSA-SHA256', 'sha256'];
  for (const pem of keys) {
    for (const algo of algos) {
      try {
        const ok = crypto.verify(algo, Buffer.from(payload, 'utf8'), pem, sig);
        if (ok) return { verified: true };
      } catch (e) {}
    }
  }
  throw new Error('signature verification failed');
}

function _installProgress(requestId, stage, percent, data) {
  const rid = String(requestId || '').trim();
  if (!rid) return;
  _broadcast('mod:install-progress', Object.assign({ requestId: rid, stage: String(stage || ''), percent: Number(percent || 0) || 0, ts: Date.now() }, (data && typeof data === 'object') ? data : {}));
}

async function _installLanmod(sourcePath, opts) {
  if (!sourcePath || typeof sourcePath !== 'string') throw new Error('missing sourcePath');
  const p = await _ensureModDirs();
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile()) throw new Error('sourcePath not a file');
  if (!sourcePath.toLowerCase().endsWith('.lanmod')) throw new Error('invalid extension');
  const workDir = path.join(p.tempDir, `install-${_nowId()}`);
  await fs.promises.mkdir(workDir, { recursive: true });
  const allowUnsigned = process.env.LANSTART_ALLOW_UNSIGNED === '1';
  let extracted = [];
  const requestId = opts && opts.requestId ? String(opts.requestId) : '';
  try {
    _installProgress(requestId, 'start', 0, { path: path.basename(sourcePath) });
    extracted = await _extractZip(sourcePath, workDir);
    _installProgress(requestId, 'extracted', 15, { files: extracted.length });
    const manifestPath = path.join(workDir, 'manifest.json');
    const manifestBuf = await fs.promises.readFile(manifestPath);
    const manifest = JSON.parse(manifestBuf.toString('utf8'));
    const parsed = _validateManifest(manifest);
    _installProgress(requestId, 'manifest', 25, { pluginId: parsed.id, version: parsed.version });
    const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
    for (const r of resources) {
      const rp = String(r && r.path || '');
      if (!_isSafeRelPath(rp)) throw new Error('invalid resource path');
      const abs = path.join(workDir, rp);
      const st = await fs.promises.stat(abs);
      const expectedSize = Number(r && r.size || st.size);
      if (st.size !== expectedSize) throw new Error('resource size mismatch');
      const h = await _sha256File(abs);
      const expected = String(r && r.sha256 || '').toLowerCase();
      if (!expected || expected !== h.toLowerCase()) throw new Error('resource hash mismatch');
    }
    _installProgress(requestId, 'resources', 45, { resources: resources.length });
    const sigRes = await _verifyLanmodSignature(workDir, manifestBuf, resources, allowUnsigned);
    _installProgress(requestId, 'signature', 60, { verified: !!(sigRes && sigRes.verified), reason: (sigRes && sigRes.reason) ? String(sigRes.reason) : '' });

    const reg = await _loadRegistry();
    const installed = await _listInstalled();
    const candidateOverrides = (manifest.overrides && typeof manifest.overrides === 'object') ? manifest.overrides : null;
    if (candidateOverrides) {
      for (const k of Object.keys(candidateOverrides)) {
        const owner = _findOverrideOwner(installed.installed, k, parsed.id);
        if (owner) throw new Error('override conflict');
      }
    }

    if (Array.isArray(parsed.dependencies)) {
      for (const dep of parsed.dependencies) {
        const depId = String(dep && dep.id || '').trim();
        const range = String(dep && dep.version || '').trim();
        const optional = !!(dep && dep.optional);
        if (!depId || !range) { if (optional) continue; throw new Error('invalid dependency'); }
        const found = installed.installed.find((x) => x.id === depId);
        if (!found || !found.manifest || !found.enabled) { if (optional) continue; throw new Error('dependency missing'); }
        const cur = String(found.manifest.version || '');
        if (!semver.satisfies(cur, range, { includePrerelease: true })) { if (optional) continue; throw new Error('dependency version mismatch'); }
      }
    }
    _installProgress(requestId, 'dependencies', 70, {});

    const targetDir = path.join(p.pluginsDir, parsed.id);
    const backupDir = path.join(p.tempDir, `backup-${parsed.id}-${_nowId()}`);
    let hadOld = false;
    try {
      const st = await fs.promises.stat(targetDir);
      if (st && st.isDirectory()) hadOld = true;
    } catch (e) {}

    if (hadOld) {
      await fs.promises.rename(targetDir, backupDir);
    }
    try {
      _installProgress(requestId, 'deploy', 85, {});
      await fs.promises.rename(workDir, targetDir);
    } catch (e) {
      if (hadOld) {
        try { await fs.promises.rename(backupDir, targetDir); } catch (err) {}
      }
      throw e;
    }

    try {
      if (!reg.plugins[parsed.id]) reg.plugins[parsed.id] = {};
      reg.plugins[parsed.id].enabled = true;
      reg.plugins[parsed.id].version = parsed.version;
      reg.plugins[parsed.id].installedAt = Date.now();
      reg.plugins[parsed.id].signature = { verified: !!(sigRes && sigRes.verified), reason: (sigRes && sigRes.reason) ? String(sigRes.reason) : '', at: Date.now() };
      if (!reg.order.includes(parsed.id)) reg.order.push(parsed.id);
      _installProgress(requestId, 'registry', 95, {});
      await _saveRegistry(reg);
    } catch (e) {
      try { await fs.promises.rm(targetDir, { recursive: true, force: true }); } catch (err) {}
      if (hadOld) {
        try { await fs.promises.rename(backupDir, targetDir); } catch (err) {}
      }
      throw e;
    } finally {
      if (hadOld) {
        try { await fs.promises.rm(backupDir, { recursive: true, force: true }); } catch (e) {}
      }
    }
    _broadcast('mod:changed', { reason: 'install', id: parsed.id });
    _installProgress(requestId, 'done', 100, { success: true, pluginId: parsed.id, version: parsed.version });
    return { success: true, id: parsed.id, version: parsed.version };
  } catch (e) {
    try { await fs.promises.rm(workDir, { recursive: true, force: true }); } catch (err) {}
    _installProgress(requestId, 'error', 100, { success: false, error: String(e && e.message || e) });
    return { success: false, error: String(e && e.message || e) };
  }
}

async function _uninstallPlugin(id) {
  const pid = String(id || '').trim();
  if (!pid) return { success: false, error: 'missing id' };
  const p = await _ensureModDirs();
  const reg = await _loadRegistry();
  const targetDir = path.join(p.pluginsDir, pid);
  try {
    await fs.promises.rm(targetDir, { recursive: true, force: true });
  } catch (e) {
    return { success: false, error: String(e && e.message || e) };
  }
  if (reg.plugins && reg.plugins[pid]) delete reg.plugins[pid];
  if (Array.isArray(reg.order)) reg.order = reg.order.filter((x) => x !== pid);
  await _saveRegistry(reg);
  _broadcast('mod:changed', { reason: 'uninstall', id: pid });
  return { success: true, id: pid };
}

async function _setPluginEnabled(id, enabled) {
  const pid = String(id || '').trim();
  if (!pid) return { success: false, error: 'missing id' };
  const reg = await _loadRegistry();
  if (!reg.plugins[pid]) reg.plugins[pid] = {};
  reg.plugins[pid].enabled = !!enabled;
  await _saveRegistry(reg);
  _broadcast('mod:changed', { reason: 'enable', id: pid, enabled: !!enabled });
  return { success: true, id: pid, enabled: !!enabled };
}

async function _setPluginOrder(order) {
  const ids = Array.isArray(order) ? order.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const reg = await _loadRegistry();
  const { installed } = await _listInstalled();
  const available = installed.map((x) => x.id);
  const availableSet = new Set(available);
  const next = [];
  const seen = new Set();
  for (const id of ids) {
    if (!availableSet.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (const id of available) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  reg.order = next;
  await _saveRegistry(reg);
  _broadcast('mod:changed', { reason: 'order', order: next });
  return { success: true, order: next };
}

async function _readPluginAsset(id, relPath, as) {
  const pid = String(id || '').trim();
  const rp = String(relPath || '').replace(/\\/g, '/');
  if (!pid) throw new Error('missing id');
  if (!_isSafeRelPath(rp)) throw new Error('invalid path');
  const p = await _ensureModDirs();
  const abs = path.join(p.pluginsDir, pid, rp);
  const buf = await fs.promises.readFile(abs);
  if (as === 'base64') return { encoding: 'base64', data: buf.toString('base64') };
  return { encoding: 'utf8', data: buf.toString('utf8') };
}

async function _getFragmentOverride(fragmentKey) {
  const key = String(fragmentKey || '').trim();
  const allow = new Set(['./tool_ui.html', './more_decide_ui.html', './setting_ui.html']);
  if (!allow.has(key)) return null;
  const { installed } = await _listInstalled();
  for (const pl of installed) {
    if (!pl.enabled) continue;
    const m = pl.manifest;
    const o = m && m.overrides && typeof m.overrides === 'object' ? m.overrides : null;
    if (!o || !o[key]) continue;
    const rel = String(o[key] || '');
    const data = await _readPluginAsset(pl.id, rel, 'utf8');
    return { pluginId: pl.id, content: data.data };
  }
  return null;
}

function _startModWatchers() {
  if (_modWatcher || _modRegistryWatcher) return;
  const p = _getModPaths();
  try {
    _modWatcher = fs.watch(p.pluginsDir, { recursive: false }, () => {
      _broadcast('mod:changed', { reason: 'fs' });
    });
  } catch (e) {}
  try {
    _modRegistryWatcher = fs.watch(p.registryPath, { recursive: false }, () => {
      _broadcast('mod:changed', { reason: 'registry' });
    });
  } catch (e) {}
}

// 尝试优先使用 ANGLE (Direct3D) 来利用系统 GPU 驱动，可能改善绘制性能并降低 CPU/内存占用。
// 在某些 Windows 机器上这有助于偏向核显/集成显卡的渲染路径。
try {
  app.commandLine.appendSwitch('use-angle', 'd3d11');
} catch (e) {}

// 明确启用硬件加速（Electron 默认启用，但显式调用以表明意图）
try { app.enableHardwareAcceleration(); } catch (e) {}

app.whenReady().then(async () => {
  createWindow({ runTests: _RUN_TESTS });
  if (_RUN_TESTS) {
    try{
      _testsTimeout = setTimeout(() => {
        try{ app.exit(1); }catch(e){ process.exit(1); }
      }, 30000);
    }catch(e){}
    return;
  }
  try { await _ensureModDirs(); } catch (e) {}
  try { _startModWatchers(); } catch (e) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * 旧版本 IPC 通信处理（向后兼容）
 */
ipcMain.on('fromRenderer', (event, arg) => {
  console.log('[IPC] 来自渲染进程:', arg);
  event.reply('fromMain', 'Pong: ' + arg);
});

ipcMain.on('tests:result', (event, payload) => {
  if (!_RUN_TESTS) return;
  try{ if (_testsTimeout) clearTimeout(_testsTimeout); }catch(e){}
  _testsTimeout = null;
  const ok = !!(payload && payload.ok);
  if (!ok) {
    try{ console.error('unit tests failed', payload && payload.error ? payload.error : payload); }catch(e){}
  }
  try{ app.exit(ok ? 0 : 1); }catch(e){ process.exit(ok ? 0 : 1); }
});

ipcMain.on('overlay:set-ignore-mouse', (event, payload) => {
  try{
    if (!mainWindow) return;
    const ignore = !!(payload && payload.ignore);
    const forward = !!(payload && payload.forward);
    _overlayIgnoreConfig = { ignore, forward };
    _applyIgnoreMouse(ignore, forward);
    if (ignore && forward) {
      const allow = _shouldAllowOverlayInteraction();
      if (allow) _applyIgnoreMouse(false, false);
      else _applyIgnoreMouse(true, true);
    }
    if (ignore && forward) _ensureOverlayPoll();
    else _stopOverlayPoll();
  }catch(err){
    console.warn('overlay:set-ignore-mouse failed', err);
  }
});

ipcMain.on('overlay:set-interactive-rects', (event, payload) => {
  try {
    const rects = payload && Array.isArray(payload.rects) ? payload.rects : [];
    _overlayInteractiveRects = rects
      .map((r) => ({
        left: Number(r && r.left) || 0,
        top: Number(r && r.top) || 0,
        width: Number(r && r.width) || 0,
        height: Number(r && r.height) || 0
      }))
      .filter((r) => r.width > 0 && r.height > 0);
    if (_overlayIgnoreConfig && _overlayIgnoreConfig.ignore && _overlayIgnoreConfig.forward) {
      const allow = _shouldAllowOverlayInteraction();
      if (allow) _applyIgnoreMouse(false, false);
      else _applyIgnoreMouse(true, true);
      _ensureOverlayPoll();
    }
  } catch (e) {}
});

ipcMain.on('app:close', () => {
  try{
    if (mainWindow) mainWindow.close();
    else app.quit();
  }catch(e){
    try{ app.quit(); }catch(err){}
  }
});

/**
 * 新版本 IPC 通信处理
 * 处理异步消息请求
 */
ipcMain.handle('message', async (event, channel, data) => {
  console.log(`[IPC] 收到消息 (${channel}):`, data);
  
  // 根据不同的消息通道进行处理
  switch(channel) {
    case 'mod:get-paths': {
      const p = await _ensureModDirs();
      return { success: true, paths: { root: p.root, pluginsDir: p.pluginsDir, tempDir: p.tempDir, configDir: p.configDir, registryPath: p.registryPath, trustPath: p.trustPath } };
    }
    case 'mod:list': {
      const res = await _listInstalled();
      return { success: true, ...res };
    }
    case 'mod:install': {
      const sourcePath = (typeof data === 'string') ? data : (data && data.path);
      const requestId = (data && typeof data === 'object' && data.requestId) ? String(data.requestId) : '';
      return await _installLanmod(sourcePath, { requestId });
    }
    case 'mod:open-install-dialog': {
      try{
        const r = await dialog.showOpenDialog(mainWindow, {
          title: '选择 .lanmod 插件文件',
          properties: ['openFile'],
          filters: [{ name: 'Lanmod Plugins', extensions: ['lanmod'] }]
        });
        if (!r || r.canceled) return { success: false, reason: 'canceled' };
        const filePath = Array.isArray(r.filePaths) && r.filePaths[0] ? String(r.filePaths[0]) : '';
        if (!filePath) return { success: false, reason: 'no_file' };
        return { success: true, path: filePath };
      }catch(e){
        return { success: false, error: String(e && e.message || e) };
      }
    }
    case 'mod:uninstall': {
      return await _uninstallPlugin(data && data.id);
    }
    case 'mod:enable': {
      return await _setPluginEnabled(data && data.id, data && data.enabled);
    }
    case 'mod:set-order': {
      return await _setPluginOrder(data && data.order);
    }
    case 'mod:read-asset': {
      try {
        const r = await _readPluginAsset(data && data.id, data && data.path, data && data.as);
        return { success: true, ...r };
      } catch (e) {
        return { success: false, error: String(e && e.message || e) };
      }
    }
    case 'mod:get-fragment-override': {
      try {
        const o = await _getFragmentOverride(data && data.key);
        if (!o) return { success: true, content: '' };
        return { success: true, pluginId: o.pluginId, content: o.content };
      } catch (e) {
        return { success: false, error: String(e && e.message || e), content: '' };
      }
    }
    case 'mod:get-registry': {
      const reg = await _loadRegistry();
      return { success: true, registry: reg };
    }
    case 'get-info':
      return {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        platform: process.platform
      };
      
    case 'open-file':
      // 处理文件打开请求等
      return { success: true, message: '处理完成' };

    case 'io:request-file-write':
      // data: { path, content }
      try{
        // 限制写入到 app.getPath('userData') 下，或接受绝对路径
        const targetPath = data && data.path ? (path.isAbsolute(data.path) ? data.path : path.join(app.getPath('userData'), data.path)) : null;
        if (!targetPath) return { success: false, message: '缺少 path' };
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, data.content || '', 'utf8');
        return { success: true, path: targetPath };
      }catch(err){
        console.error('file write failed', err);
        return { success: false, error: String(err) };
      }
      
    default:
      return { success: true, data };
  }
});

/**
 * 同步消息处理
 * 处理来自渲染进程的同步请求
 */
ipcMain.on('sync-message', (event, channel, data) => {
  console.log(`[IPC] 收到同步消息 (${channel}):`, data);
  
  // 同步回复
  event.returnValue = {
    success: true,
    channel,
    timestamp: Date.now()
  };
});

/**
 * 广播消息给所有窗口
 * @param {string} channel - 消息通道
 * @param {*} data - 消息数据
 */
function broadcastMessage(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}
