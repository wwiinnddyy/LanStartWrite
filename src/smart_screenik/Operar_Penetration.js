export default class OperarPenetration {
  static get UI_SELECTORS() {
    return {
      floatingPanel: '.floating-panel',
      submenu: '.submenu.open',
      recognition: '.recognition-ui.open',
      settings: '.settings-modal.open',
      pageToolbar: '#pageToolbar',
      openUi: '.settings-modal.open, .recognition-ui.open, .submenu.open, .mod-overlay.open',
      touchBlockTargets: '.floating-panel, .submenu, .settings-modal, .recognition-ui, .mod-overlay, #settingsModal, #pluginModal, #aboutModal, #pageToolbar, .video-booth-window'
    };
  }

  static isUiTarget(target) {
    try {
      if (!target || !target.closest) return false;
      return !!target.closest(OperarPenetration.UI_SELECTORS.touchBlockTargets);
    } catch (e) {
      return false;
    }
  }

  constructor(opts = {}) {
    this.opts = opts || {};
    this.appModes = this.opts.appModes || { WHITEBOARD: 'whiteboard', ANNOTATION: 'annotation' };
    this.getAppMode = typeof this.opts.getAppMode === 'function' ? this.opts.getAppMode : () => this.appModes.WHITEBOARD;
    this.isPointerActive = typeof this.opts.isPointerActive === 'function' ? this.opts.isPointerActive : () => false;
    this.debug = typeof this.opts.debug === 'function' ? this.opts.debug : () => {};
    this.sendToMain = typeof this.opts.sendToMain === 'function' ? this.opts.sendToMain : null;
    this.selectors = Object.assign({}, OperarPenetration.UI_SELECTORS, this.opts.selectors || {});
    this.lastSentIgnore = null;
    this.lastSentRectsJson = '';
    this.cachedRects = null;
    this.cachedRectsAt = 0;
    this.interactiveRectsRaf = 0;
    this.rectWatchdogTimer = 0;
    this.lastIgnoreMouse = { ignore: false, forward: false, at: 0 };
    this.activeInputType = 'mouse';
    this.touchShield = null;
    this.touchBlockIds = new Set();
    this.touchBlockActive = false;
    this.touchBlockRestoreT = 0;
    this.lastInputAt = 0;
    this.lastPenActionAt = 0;
    this.lastTouchActionAt = 0;
    this.lastMouseMoveAt = 0;
    this.interactivityTimer = 0;
    this.interactivityForceIgnore = false;
    this.touchReapplyTimer = 0;
    this.bound = false;
    this.initialized = false;
    this.touchInitialized = false;
    this.featureActive = false;
    this.savedPenetrationState = null;
    this.prevState = { ignore: null, rectsJson: '', touchBlockActive: false, lastTouchActionAt: 0 };
  }

  getLastIgnoreMouse() {
    return this.lastIgnoreMouse;
  }

  getLastTouchActionAt() {
    return this.lastTouchActionAt;
  }

  getActiveInputType() {
    return this.activeInputType;
  }

  markTouchAction() {
    this.lastTouchActionAt = Date.now();
  }

  shouldSuppressClick() {
    return Date.now() - this.lastTouchActionAt < 400;
  }

  normalizePointerType(type) {
    const t = String(type || '');
    if (t === 'mouse' || t === 'touch' || t === 'pen') return t;
    return '';
  }

  recordPointerInput(type) {
    const t = this.normalizePointerType(type);
    if (!t) return;
    const now = Date.now();
    this.activeInputType = t;
    this.lastInputAt = now;
    if (t === 'mouse') {
      this.lastMouseMoveAt = now;
    } else if (t === 'pen') {
      this.lastPenActionAt = now;
      this.lastTouchActionAt = now;
    } else {
      this.lastTouchActionAt = now;
    }
  }

  getInputCapabilities() {
    const caps = { touch: false, mouse: false, pen: false };
    try {
      const n = navigator;
      if (n && typeof n.maxTouchPoints === 'number' && n.maxTouchPoints > 0) caps.touch = true;
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && window.matchMedia) {
        if (window.matchMedia('(any-pointer: coarse)').matches) caps.touch = true;
        if (window.matchMedia('(any-pointer: fine)').matches) caps.mouse = true;
        if (window.matchMedia('(any-hover: hover)').matches) caps.mouse = true;
        if (window.matchMedia('(any-pointer: pen)').matches) caps.pen = true;
      }
    } catch (e) {}
    return caps;
  }

  isTouchEnvironment() {
    const caps = this.getInputCapabilities();
    return !!caps.touch;
  }

  ensureTouchShield() {
    if (this.touchShield) return this.touchShield;
    const el = document.createElement('div');
    el.id = 'touchShield';
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    el.style.zIndex = '2000';
    el.style.background = 'transparent';
    el.style.display = 'none';
    el.style.touchAction = 'none';
    try { document.body.appendChild(el); } catch (e) {}
    this.touchShield = el;
    return el;
  }

  setTouchShieldActive(on) {
    const el = this.ensureTouchShield();
    if (!el) return;
    el.style.display = on ? 'block' : 'none';
    el.style.pointerEvents = on ? 'auto' : 'none';
  }

  touchIdsFromEvent(e) {
    const ids = [];
    if (e && typeof e.pointerId === 'number' && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
      ids.push(e.pointerId);
      return ids;
    }
    const list = (e && e.changedTouches) ? e.changedTouches : null;
    if (!list || typeof list.length !== 'number') return ids;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t) continue;
      ids.push(t.identifier);
    }
    return ids;
  }

  beginTouchUiBlock(e) {
    const pointerType = this.normalizePointerType(e && e.pointerType);
    this.recordPointerInput(pointerType || 'touch');
    const ids = this.touchIdsFromEvent(e);
    for (const id of ids) this.touchBlockIds.add(id);
    if (this.touchBlockRestoreT) {
      try { clearTimeout(this.touchBlockRestoreT); } catch (err) {}
      this.touchBlockRestoreT = 0;
    }
    if (this.touchBlockActive) return;
    this.touchBlockActive = true;
    try { this.sendIgnoreMouse(false, false); } catch (err) {}
    const isFullScreenUi = !!document.querySelector('.settings-modal.open, .recognition-ui.open, .mod-overlay.open');
    this.setTouchShieldActive(!!isFullScreenUi);
    try { this.scheduleInteractiveRectsUpdate(); } catch (err) {}
  }

  endTouchUiBlock(e) {
    const ids = this.touchIdsFromEvent(e);
    for (const id of ids) this.touchBlockIds.delete(id);
    if (this.touchBlockIds.size > 0) return;
    if (!this.touchBlockActive) return;
    this.touchBlockActive = false;
    this.touchBlockRestoreT = setTimeout(() => {
      this.touchBlockRestoreT = 0;
      this.setTouchShieldActive(false);
      try { this.applyWindowInteractivity(); } catch (err) {}
      try { this.scheduleInteractiveRectsUpdate(); } catch (err) {}
    }, 120);
  }

  forceReleaseTouchUiBlock() {
    if (this.touchBlockRestoreT) {
      try { clearTimeout(this.touchBlockRestoreT); } catch (err) {}
      this.touchBlockRestoreT = 0;
    }
    if (this.touchBlockIds && this.touchBlockIds.size) this.touchBlockIds.clear();
    if (this.touchBlockActive) this.touchBlockActive = false;
    this.setTouchShieldActive(false);
  }

  sendIgnoreMouse(ignore, forward) {
    try {
      if (!this.sendToMain) return;
      const key = `${ignore ? 1 : 0}:${forward ? 1 : 0}`;
      if (this.lastSentIgnore === key) return;
      this.lastSentIgnore = key;
      this.lastIgnoreMouse = { ignore: !!ignore, forward: !!forward, at: Date.now() };
      this.debug('overlay', 'ignore-mouse', { ignore: !!ignore, forward: !!forward, mode: this.getAppMode() });
      this.sendToMain('overlay:set-ignore-mouse', { ignore: !!ignore, forward: !!forward });
    } catch (e) {}
  }

  sendInteractiveRects(rects) {
    try {
      if (!this.sendToMain) return;
      const json = JSON.stringify(rects);
      if (json === this.lastSentRectsJson) return;
      this.lastSentRectsJson = json;
      this.debug('overlay', 'interactive-rects', { count: Array.isArray(rects) ? rects.length : 0 });
      this.sendToMain('overlay:set-interactive-rects', { rects: Array.isArray(rects) ? rects : [] });
    } catch (e) {}
  }

  collectInteractiveRects(force = false) {
    const now = Date.now();
    if (!force && this.cachedRects && (now - this.cachedRectsAt < 100)) return this.cachedRects;
    const rects = [];
    const pushEl = (el) => {
      if (!el || !el.getBoundingClientRect) return;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, r.width || 0);
      const h = Math.max(0, r.height || 0);
      if (w <= 0 || h <= 0) return;
      rects.push({ left: r.left, top: r.top, width: w, height: h });
    };
    if (this.selectors.floatingPanel) pushEl(document.querySelector(this.selectors.floatingPanel));
    if (this.selectors.submenu) document.querySelectorAll(this.selectors.submenu).forEach(pushEl);
    if (this.selectors.recognition) document.querySelectorAll(this.selectors.recognition).forEach(pushEl);
    if (this.selectors.settings) document.querySelectorAll(this.selectors.settings).forEach(pushEl);
    if (this.selectors.pageToolbar) pushEl(document.querySelector(this.selectors.pageToolbar));
    if (typeof this.opts.extendInteractiveRects === 'function') {
      try {
        const extra = this.opts.extendInteractiveRects() || [];
        if (Array.isArray(extra)) {
          for (const r of extra) {
            if (!r) continue;
            const w = Math.max(0, Number(r.width) || 0);
            const h = Math.max(0, Number(r.height) || 0);
            if (w <= 0 || h <= 0) continue;
            rects.push({ left: Number(r.left) || 0, top: Number(r.top) || 0, width: w, height: h });
          }
        }
      } catch (e) {}
    }
    this.cachedRects = rects;
    this.cachedRectsAt = now;
    return rects;
  }

  scheduleInteractiveRectsUpdate() {
    if (this.getAppMode() !== this.appModes.ANNOTATION) return;
    if (this.interactiveRectsRaf) return;
    this.interactiveRectsRaf = requestAnimationFrame(() => {
      this.interactiveRectsRaf = 0;
      this.sendInteractiveRects(this.collectInteractiveRects());
    });
  }

  flushInteractiveRects() {
    if (this.getAppMode() !== this.appModes.ANNOTATION) return;
    try { this.sendInteractiveRects(this.collectInteractiveRects()); } catch (e) {}
  }

  setRectWatchdog(on) {
    const next = !!on;
    if (next) {
      if (this.rectWatchdogTimer) return;
      this.rectWatchdogTimer = setInterval(() => {
        try {
          if (this.getAppMode() !== this.appModes.ANNOTATION) return;
          if (!this.isPointerActive()) return;
          this.sendInteractiveRects(this.collectInteractiveRects());
        } catch (e) {}
      }, 200);
      return;
    }
    if (this.rectWatchdogTimer) {
      try { clearInterval(this.rectWatchdogTimer); } catch (e) {}
      this.rectWatchdogTimer = 0;
    }
  }

  applyWindowInteractivity(forceIgnore) {
    if (forceIgnore) this.interactivityForceIgnore = true;
    if (this.interactivityTimer) return;
    this.interactivityTimer = setTimeout(() => {
      const force = this.interactivityForceIgnore;
      this.interactivityForceIgnore = false;
      this.interactivityTimer = 0;
      this.applyWindowInteractivityNow(force);
    }, 16);
  }

  applyWindowInteractivityNow(forceIgnore) {
    const appMode = this.getAppMode();
    const hasFullScreenUi = !!document.querySelector('.settings-modal.open, .recognition-ui.open, .mod-overlay.open');
    const hasSubmenuOpen = !!document.querySelector('.submenu.open');
    const pointerActive = !!this.isPointerActive();
    const featureActive = appMode === this.appModes.ANNOTATION && pointerActive;

    if (this.featureActive && !featureActive) {
      this.savedPenetrationState = {
        ignore: this.lastIgnoreMouse ? { ignore: !!this.lastIgnoreMouse.ignore, forward: !!this.lastIgnoreMouse.forward } : { ignore: false, forward: false },
        touchBlockActive: !!this.touchBlockActive,
        lastTouchActionAt: Number(this.lastTouchActionAt) || 0
      };
    }
    this.featureActive = featureActive;

    if (hasFullScreenUi) {
      this.debug('interactivity', 'open-ui');
      try { this.forceReleaseTouchUiBlock(); } catch (e) {}
      this.sendIgnoreMouse(false, false);
      try { this.sendInteractiveRects(this.collectInteractiveRects()); } catch (e) {}
      this.setRectWatchdog(false);
      return;
    }
    if (appMode === this.appModes.WHITEBOARD) {
      this.debug('interactivity', 'whiteboard');
      try { this.forceReleaseTouchUiBlock(); } catch (e) {}
      this.sendIgnoreMouse(false, false);
      this.setRectWatchdog(false);
      return;
    }
    if (!pointerActive) {
      this.debug('interactivity', 'no-pointer');
      try { this.forceReleaseTouchUiBlock(); } catch (e) {}
      this.sendIgnoreMouse(false, false);
      this.setRectWatchdog(false);
      return;
    }
    if (this.touchBlockActive) {
      this.debug('interactivity', 'touch-block');
      this.sendIgnoreMouse(false, false);
      try { this.sendInteractiveRects(this.collectInteractiveRects()); } catch (e) {}
      this.setRectWatchdog(false);
      this.scheduleInteractiveRectsUpdate();
      return;
    }
    if (!forceIgnore) {
      const now = Date.now();
      const recentTouch = (now - this.lastTouchActionAt) < 1500;
      const recentPen = (now - this.lastPenActionAt) < 1500;
      const recentDirect = (now - this.lastInputAt) < 1500 && (this.activeInputType === 'touch' || this.activeInputType === 'pen');
      const shouldEnforceRecent = (appMode !== this.appModes.ANNOTATION);
      if ((recentTouch || recentPen || recentDirect) && shouldEnforceRecent) {
        this.debug('interactivity', 'recent-touch-force-interactive');
        this.sendIgnoreMouse(false, false);
        try { this.sendInteractiveRects(this.collectInteractiveRects()); } catch (e) {}
        this.setRectWatchdog(false);
        this.scheduleInteractiveRectsUpdate();
        this.scheduleTouchReapply();
        return;
      }
    }

    if (this.savedPenetrationState && !forceIgnore) {
      const s = this.savedPenetrationState;
      const now = Date.now();
      const recentTouch = (now - this.lastTouchActionAt) < 1500;
      const recentPen = (now - this.lastPenActionAt) < 1500;
      const recentDirect = (now - this.lastInputAt) < 1500 && (this.activeInputType === 'touch' || this.activeInputType === 'pen');
      const shouldKeepInteractive = (recentTouch || recentPen || recentDirect);
      if (!shouldKeepInteractive) {
        try { this.setTouchShieldActive(!!s.touchBlockActive); } catch (e) {}
        try { this.sendIgnoreMouse(!!(s.ignore && s.ignore.ignore), !!(s.ignore && s.ignore.forward)); } catch (e) {}
        this.savedPenetrationState = null;
      }
    }

    try { this.sendInteractiveRects(this.collectInteractiveRects()); } catch (e) {}
    this.debug('interactivity', 'pointer-ignore');
    this.sendIgnoreMouse(true, true);
    this.setRectWatchdog(true);
    this.scheduleInteractiveRectsUpdate();
  }

  scheduleTouchReapply() {
    if (this.touchReapplyTimer) return;
    this.touchReapplyTimer = setTimeout(() => {
      this.touchReapplyTimer = 0;
      try { this.applyWindowInteractivity(); } catch (e) {}
    }, 1700);
  }

  checkTouchIntersection(e) {
    const touches = (e && e.touches) ? e.touches : [];
    if (!touches || touches.length === 0) return false;
    const rects = this.collectInteractiveRects();
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const x = t.clientX;
      const y = t.clientY;
      for (const r of rects) {
        if (x >= r.left && x <= r.left + r.width &&
            y >= r.top && y <= r.top + r.height) {
          return true;
        }
      }
    }
    return false;
  }

  handleTouchMove(e) {
    if (this.getAppMode() !== this.appModes.ANNOTATION) return;
    if (!this.isPointerActive()) return;
    const now = Date.now();
    if (now - this.lastTouchCheckAt < 40) return;
    this.lastTouchCheckAt = now;
    const isHit = this.checkTouchIntersection(e);
    if (isHit) {
      if (!this.touchBlockActive) {
        this.touchBlockActive = true;
        this.sendIgnoreMouse(false, false);
      }
      this.scheduleInteractiveRectsUpdate();
    } else {
      if (this.touchBlockActive && this.touchBlockIds.size === 0) {
        this.touchBlockActive = false;
        this.applyWindowInteractivityNow();
      }
    }
  }

  bindGlobalListeners() {
    if (this.bound) return;
    this.bound = true;
    try {
      document.addEventListener('touchstart', (e) => {
        try {
          const t = e && e.target && e.target.closest ? e.target.closest(this.selectors.touchBlockTargets) : null;
          if (!t) return;
          this.beginTouchUiBlock(e);
        } catch (err) {}
      }, { capture: true, passive: true });
      document.addEventListener('touchend', (e) => { try { this.endTouchUiBlock(e); } catch (err) {} }, { capture: true });
      document.addEventListener('touchcancel', (e) => { try { this.endTouchUiBlock(e); } catch (err) {} }, { capture: true });
      document.addEventListener('touchmove', (e) => { try { this.handleTouchMove(e); } catch (err) {} }, { capture: true, passive: true });
      document.addEventListener('pointerdown', (e) => {
        try {
          const t = this.normalizePointerType(e && e.pointerType);
          if (!t) return;
          if (t === 'mouse') {
            if (Date.now() - this.lastTouchActionAt < 400) return;
            this.recordPointerInput('mouse');
            return;
          }
          this.recordPointerInput(t);
          const target = e && e.target && e.target.closest ? e.target.closest(this.selectors.touchBlockTargets) : null;
          if (!target) return;
          this.beginTouchUiBlock(e);
        } catch (err) {}
      }, { capture: true, passive: true });
      document.addEventListener('pointerup', (e) => { try { if (e && (e.pointerType === 'touch' || e.pointerType === 'pen')) this.endTouchUiBlock(e); } catch (err) {} }, { capture: true });
      document.addEventListener('pointercancel', (e) => { try { if (e && (e.pointerType === 'touch' || e.pointerType === 'pen')) this.endTouchUiBlock(e); } catch (err) {} }, { capture: true });
      document.addEventListener('mousedown', () => { if (Date.now() - this.lastTouchActionAt < 400) return; this.recordPointerInput('mouse'); }, { capture: true });
      if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', (e) => {
          if (e && e.pointerType === 'mouse') {
            if (Date.now() - this.lastTouchActionAt >= 400) this.recordPointerInput('mouse');
          }
        }, { passive: true });
        window.addEventListener('mousemove', () => { if (Date.now() - this.lastTouchActionAt >= 400) this.recordPointerInput('mouse'); }, { passive: true });
      }
    } catch (e) {}
    this.initialized = true;
    if (this.isTouchEnvironment() && !this.touchInitialized) {
      this.touchInitialized = true;
      this.ensureTouchShield();
      this.activeInputType = 'touch';
      this.lastInputAt = Date.now();
      this.debug('interactivity', 'init');
      this.applyWindowInteractivityNow();
      this.scheduleInteractiveRectsUpdate();
    }
  }

  saveStateSnapshot() {
    this.prevState = {
      ignore: this.lastIgnoreMouse ? { ignore: !!this.lastIgnoreMouse.ignore, forward: !!this.lastIgnoreMouse.forward } : null,
      rectsJson: String(this.lastSentRectsJson || ''),
      touchBlockActive: !!this.touchBlockActive,
      lastTouchActionAt: Number(this.lastTouchActionAt) || 0
    };
  }

  restorePreviousState() {
    const p = this.prevState || {};
    if (p.touchBlockActive) this.setTouchShieldActive(true);
    if (p.ignore) this.sendIgnoreMouse(!!p.ignore.ignore, !!p.ignore.forward);
    try { this.sendInteractiveRects(this.collectInteractiveRects()); } catch (e) {}
    if (!p.touchBlockActive) this.setTouchShieldActive(false);
  }
}
