const _defs = new Map();
const _instances = new Map();
const _layouts = new Map();

function _normalizeId(id) {
  return String(id || "").trim();
}

function _normalizeIcon(def) {
  const d = def && typeof def === "object" ? def : {};
  return {
    iconSvg: d.iconSvg ? String(d.iconSvg || "") : "",
    iconUrl: d.iconUrl ? String(d.iconUrl || "") : "",
    iconClass: d.iconClass ? String(d.iconClass || "") : "",
    label: d.label ? String(d.label || "") : ""
  };
}

function _mergeDefs(oldDef, nextDef) {
  const a = oldDef && typeof oldDef === "object" ? oldDef : {};
  const b = nextDef && typeof nextDef === "object" ? nextDef : {};
  const mergedIcon = _normalizeIcon(Object.assign({}, a, b));
  return Object.assign({}, a, b, mergedIcon);
}

export function registerButton(def) {
  const d = def && typeof def === "object" ? def : {};
  const id = _normalizeId(d.id || d.buttonId || d.featureId || d.domId);
  if (!id) return null;
  const prev = _defs.get(id);
  const base = Object.assign(
    {
      id,
      kind: "toolbar",
      size: "medium",
      source: "core",
      locations: [],
      onClick: null
    },
    d
  );
  const merged = _mergeDefs(prev, base);
  _defs.set(id, merged);
  return merged;
}

export function getButton(id) {
  const key = _normalizeId(id);
  if (!key) return null;
  return _defs.get(key) || null;
}

export function ensureButton(def) {
  if (!def) return null;
  const d = typeof def === "string" ? { id: def } : def;
  const id = _normalizeId(d.id || d.buttonId || d.featureId || d.domId);
  if (!id) return null;
  const existing = _defs.get(id);
  if (existing) return existing;
  return registerButton(d);
}

export function registerLayoutTemplate(name, config) {
  const key = String(name || "");
  if (!key) return null;
  const cfg = config && typeof config === "object" ? config : {};
  const order = Array.isArray(cfg.order) ? cfg.order.map((v) => String(v || "")).filter(Boolean) : [];
  const hidden = Array.isArray(cfg.hidden) ? cfg.hidden.map((v) => String(v || "")).filter(Boolean) : [];
  const meta = { name: key, order, hidden };
  _layouts.set(key, meta);
  return meta;
}

export function getLayoutTemplate(name) {
  const key = String(name || "");
  if (!key) return null;
  return _layouts.get(key) || null;
}

export function applyLayoutTemplate(name, items, settingsLike) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { order: [], hiddenSet: new Set() };
  const tpl = getLayoutTemplate(name);
  const s = settingsLike && typeof settingsLike === "object" ? settingsLike : {};
  const rawOrder = Array.isArray(s.toolbarButtonOrder) ? s.toolbarButtonOrder : [];
  const rawHidden = Array.isArray(s.toolbarButtonHidden) ? s.toolbarButtonHidden : [];
  const allIds = list.map((it) => String(it.id || "")).filter(Boolean);
  const tplOrder = tpl && Array.isArray(tpl.order) ? tpl.order : [];
  const tplHidden = tpl && Array.isArray(tpl.hidden) ? tpl.hidden : [];
  const order = [];
  for (const v of rawOrder) {
    const id = String(v || "");
    if (!id) continue;
    if (!allIds.includes(id)) continue;
    if (!order.includes(id)) order.push(id);
  }
  if (!order.length) {
    for (const v of tplOrder) {
      const id = String(v || "");
      if (!id) continue;
      if (!allIds.includes(id)) continue;
      if (!order.includes(id)) order.push(id);
    }
  }
  for (const id of allIds) {
    if (!order.includes(id)) order.push(id);
  }
  const hiddenIds = [];
  for (const v of rawHidden) {
    const id = String(v || "");
    if (!id) continue;
    if (!allIds.includes(id)) continue;
    if (!hiddenIds.includes(id)) hiddenIds.push(id);
  }
  if (!hiddenIds.length) {
    for (const v of tplHidden) {
      const id = String(v || "");
      if (!id) continue;
      if (!allIds.includes(id)) continue;
      if (!hiddenIds.includes(id)) hiddenIds.push(id);
    }
  }
  const hiddenSet = new Set(hiddenIds);
  return { order, hiddenSet };
}

function _applyIconToButton(el, iconDef) {
  if (!el) return;
  const icon = _normalizeIcon(iconDef);
  if (icon.iconSvg && icon.iconSvg.trim()) {
    el.innerHTML = icon.iconSvg;
    return;
  }
  if (icon.iconUrl && icon.iconUrl.trim()) {
    el.innerHTML = "";
    const img = document.createElement("img");
    img.src = icon.iconUrl;
    img.alt = "";
    img.draggable = false;
    try {
      img.style.width = "22px";
      img.style.height = "22px";
    } catch (e) {}
    el.appendChild(img);
    return;
  }
  if (icon.iconClass && icon.iconClass.trim()) {
    el.innerHTML = "";
    const i = document.createElement("i");
    i.className = icon.iconClass;
    el.appendChild(i);
    return;
  }
  el.textContent = icon.label || "";
}

function _resolveDef(input) {
  if (!input) return null;
  if (typeof input === "string") return getButton(input);
  if (typeof input === "object") {
    if (input.id || input.buttonId || input.featureId || input.domId) {
      return ensureButton(input);
    }
  }
  return null;
}

export function createButtonElement(input, options) {
  const def = _resolveDef(input);
  if (!def) return null;
  const opts = options && typeof options === "object" ? options : {};
  const variant = String(opts.variant || def.variant || def.kind || "toolbar");
  const disabled = !!opts.disabled;
  const preview = !!opts.preview;
  const el = document.createElement("button");
  const baseClass =
    variant === "mode"
      ? "mode-btn"
      : variant === "menu"
      ? "tool-btn"
      : "tool-btn";
  const extraClass = opts.className ? String(opts.className || "") : "";
  el.className = extraClass ? `${baseClass} ${extraClass}` : baseClass;
  const domId = opts.domId || def.domId;
  if (domId) el.id = String(domId);
  const title = opts.title || def.title || def.label || "";
  if (title) {
    el.setAttribute("title", title);
    el.setAttribute("aria-label", title);
  }
  if (disabled) {
    el.disabled = true;
    el.setAttribute("tabindex", "-1");
  }
  _applyIconToButton(el, def);
  if (!preview) {
    const handler =
      typeof opts.onClick === "function"
        ? opts.onClick
        : typeof def.onClick === "function"
        ? def.onClick
        : null;
    if (handler) {
      el.addEventListener("click", (ev) => {
        try {
          handler(ev, { def, el, variant });
        } catch (e) {}
      });
    }
  }
  return el;
}

export function createToolbarButtonForFeature(featureId, defLike, options) {
  const fid = String(featureId || "");
  if (!fid) return null;
  const extra = defLike && typeof defLike === "object" ? defLike : {};
  const merged = Object.assign(
    {
      id: fid,
      featureId: fid,
      kind: "feature",
      source: "feature"
    },
    extra
  );
  const reg = ensureButton(merged);
  if (!reg) return null;
  const opts = options && typeof options === "object" ? options : {};
  const btn = createButtonElement(reg, Object.assign({}, opts, { variant: "toolbar" }));
  if (!btn) return null;
  registerInstance(reg.id, btn, "toolbar");
  return btn;
}

export function registerInstance(id, el, location) {
  const key = _normalizeId(id);
  if (!key || !el) return;
  const loc = String(location || "");
  const meta = { id: key, el, location: loc };
  _instances.set(el, meta);
  try {
    el.dataset.buttonId = key;
    if (loc) el.dataset.buttonLocation = loc;
  } catch (e) {}
  const def = getButton(key);
  if (def) {
    const locs = Array.isArray(def.locations) ? def.locations.slice() : [];
    if (loc && !locs.includes(loc)) {
      locs.push(loc);
      _defs.set(key, Object.assign({}, def, { locations: locs }));
    }
  }
}

export function getInstance(el) {
  if (!el) return null;
  return _instances.get(el) || null;
}

export function listButtons(filter) {
  const out = [];
  const f = filter && typeof filter === "object" ? filter : {};
  const kind = f.kind ? String(f.kind || "") : "";
  const source = f.source ? String(f.source || "") : "";
  const location = f.location ? String(f.location || "") : "";
  for (const def of _defs.values()) {
    if (kind && String(def.kind || "") !== kind) continue;
    if (source && String(def.source || "") !== source) continue;
    if (location) {
      const locs = Array.isArray(def.locations) ? def.locations : [];
      if (!locs.includes(location)) continue;
    }
    out.push(def);
  }
  return out;
}

export default {
  registerButton,
  getButton,
  ensureButton,
  createButtonElement,
  registerInstance,
  getInstance,
  listButtons,
  registerLayoutTemplate,
  getLayoutTemplate,
  applyLayoutTemplate,
  createToolbarButtonForFeature
};
