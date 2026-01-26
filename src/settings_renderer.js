import Settings, { loadSettings, saveSettings, installHyperOsButtonInteractions, normalizeHexColor, rgbToHex, hexToRgb, loadRecentColors, pushRecentColor } from './setting.js';
import Message, { EVENTS } from './message.js';
import { buildPenTailSegment, normalizePenTailSettings } from './pen_tail.js';
import { applyThemeMode, buildContrastReport } from './colors_features.js';
import Mod from './mod.js';
import { installHyperOs3Controls, loadSettingsHistory, clearSettingsHistory, undoSettingsHistoryEntry, undoSettingsHistoryBatch, updateAppSettings } from './write_a_change.js';

// DOM Elements
const sidebar = document.getElementById('sidebar');
const settingsContainer = document.getElementById('settingsContainer');
const tabs = document.querySelectorAll('.settings-tab');
const pages = document.querySelectorAll('.settings-page');
const closeBtn = document.getElementById('closeBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');
const closeWhiteboardBtn = document.getElementById('closeWhiteboardBtn');

// Previews
const penTailPreview = document.getElementById('penTailPreview');
const themePreviewReport = document.getElementById('themePreviewReport');

let updateThemePreview;
let updatePenTailPreview;
let initialSettingsJSON = '';
let isChangeListenersInitialized = false;
let _lastPersistedJSON = '';
let _autoSaveTimer = 0;

let _lsColorModalBackdrop = null;
let _lsColorModal = null;
let _lsColorModalHeader = null;
let _lsColorModalClose = null;
let _lsColorSpectrum = null;
let _lsColorSpectrumCtx = null;
let _lsColorPreview = null;
let _lsColorDragState = null;
let _lsColorModalDrag = null;
let _lsColorActive = null;
let _lsColorHexInput = null;
let _lsColorRgbR = null;
let _lsColorRgbG = null;
let _lsColorRgbB = null;
let _lsColorRecent = null;
let _lsColorModalUpdating = false;

function hideColorModal(){
    if (_lsColorSpectrum && _lsColorDragState) {
        try{ _lsColorSpectrum.releasePointerCapture(_lsColorDragState.id); }catch(e){}
    }
    _lsColorDragState = null;
    _lsColorActive = null;
    if (_lsColorModalBackdrop) {
        try{ _lsColorModalBackdrop.style.display = 'none'; }catch(e){}
    }
}

function _lsRenderRecentColors(list){
    if (!_lsColorRecent) return;
    let arr = Array.isArray(list) ? list.slice() : [];
    if (!arr.length) {
        try{ arr = loadRecentColors(12); }catch(e){ arr = []; }
    }
    _lsColorRecent.innerHTML = '';
    for (const c of arr) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ls-recent-chip';
        btn.title = c;
        btn.setAttribute('aria-label', c);
        btn.dataset.hex = c;
        try{ btn.style.background = c; }catch(e){}
        btn.addEventListener('click', ()=>{
            if (_lsColorActive && _lsColorActive.applyHex) {
                _lsColorActive.applyHex(c);
            }
        });
        _lsColorRecent.appendChild(btn);
    }
}

function _lsUpdateModalControls(hex, opts){
    if (!_lsColorHexInput || !_lsColorRgbR || !_lsColorRgbG || !_lsColorRgbB) return;
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const o = (opts && typeof opts === 'object') ? opts : {};
    _lsColorModalUpdating = true;
    try{
        _lsColorHexInput.value = hex;
        _lsColorRgbR.value = String(rgb.r);
        _lsColorRgbG.value = String(rgb.g);
        _lsColorRgbB.value = String(rgb.b);
    }catch(e){}
    _lsColorModalUpdating = false;
    if (o.push) {
        try{
            const list = pushRecentColor(hex, 12);
            _lsRenderRecentColors(list);
        }catch(e){}
    }
}

// Simple Toast Implementation for Settings Window
function showToast(msg, type='success', ms=1800){
  let t = document.querySelector('.app-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'app-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.remove('success','error');
  t.classList.add(type);
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(t._hideT);
  t._hideT = setTimeout(()=>{ t.classList.remove('show'); }, ms);
}

function initColorPickers(){
    const inputs = Array.from(document.querySelectorAll('input[type="color"]'));
    if (!inputs.length) return;
    for (const native of inputs) {
        try{ enhanceColorInput(native); }catch(e){}
    }
}

function enhanceColorInput(native){
    if (!native || native.nodeType !== 1) return;
    if (native.dataset && native.dataset.lsColorEnhanced === '1') return;
    if (native.dataset) native.dataset.lsColorEnhanced = '1';

    const label = native.closest && native.closest('.settings-field');
    if (!label) return;

    const wrap = document.createElement('div');
    wrap.className = 'ls-color-field';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'ls-color-swatch';
    swatch.setAttribute('aria-label', '打开颜色选择器');
    const swatchInner = document.createElement('div');
    swatchInner.className = 'ls-color-swatch-inner';
    swatch.appendChild(swatchInner);

    const parent = native.parentElement;
    if (!parent) return;

    parent.insertBefore(wrap, native);
    wrap.appendChild(swatch);
    wrap.appendChild(native);
    try{ native.style.display = 'none'; }catch(e){}

    let updating = false;

    const applyHex = (hex, opts)=>{
        const o = (opts && typeof opts === 'object') ? opts : {};
        const fallback = normalizeHexColor(native.value, '#000000');
        const next = normalizeHexColor(hex, fallback);
        if (!next) return;

        updating = true;
        try{ native.value = next; }catch(e){}
        try{ swatchInner.style.background = next; }catch(e){}
        updating = false;

        try{ _lsUpdateModalControls(next, { push: !!o.push }); }catch(e){}

        if (o.fire) {
            try{
                native.dispatchEvent(new Event('input', { bubbles: true }));
                native.dispatchEvent(new Event('change', { bubbles: true }));
            }catch(e){}
        }
    };

    const openModal = ()=>{
        if (!_lsColorModalBackdrop) {
            _lsColorModalBackdrop = document.getElementById('lsColorModalBackdrop');
            _lsColorModal = document.getElementById('lsColorModal');
            _lsColorModalHeader = document.getElementById('lsColorModalHeader');
            _lsColorModalClose = document.getElementById('lsColorModalClose');
            _lsColorSpectrum = document.getElementById('lsColorSpectrum');
            _lsColorPreview = document.getElementById('lsColorPreview');
            _lsColorHexInput = document.getElementById('lsColorHex');
            _lsColorRgbR = document.getElementById('lsColorR');
            _lsColorRgbG = document.getElementById('lsColorG');
            _lsColorRgbB = document.getElementById('lsColorB');
            _lsColorRecent = document.getElementById('lsRecentColors');
            if (_lsColorSpectrum && !_lsColorSpectrumCtx) {
                _lsColorSpectrumCtx = _lsColorSpectrum.getContext('2d');
            }
            if (_lsColorHexInput) {
                _lsColorHexInput.addEventListener('input', ()=>{
                    if (_lsColorModalUpdating) return;
                    const v = String(_lsColorHexInput.value || '').trim();
                    const next = normalizeHexColor(v, '');
                    if (!next) return;
                    if (_lsColorActive && _lsColorActive.applyHex) {
                        _lsColorActive.applyHex(next);
                    }
                });
            }
            if (_lsColorRgbR && _lsColorRgbG && _lsColorRgbB) {
                const onRgbChange = ()=>{
                    if (_lsColorModalUpdating) return;
                    const r = Number(_lsColorRgbR.value);
                    const g = Number(_lsColorRgbG.value);
                    const b = Number(_lsColorRgbB.value);
                    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return;
                    const hex = rgbToHex({ r, g, b });
                    if (_lsColorActive && _lsColorActive.applyHex) {
                        _lsColorActive.applyHex(hex);
                    }
                };
                _lsColorRgbR.addEventListener('input', onRgbChange);
                _lsColorRgbG.addEventListener('input', onRgbChange);
                _lsColorRgbB.addEventListener('input', onRgbChange);
            }
            if (_lsColorModalBackdrop && _lsColorModal) {
                _lsColorModalBackdrop.addEventListener('click', (e)=>{
                    if (e.target === _lsColorModalBackdrop) {
                        hideColorModal();
                    }
                });
            }
            if (_lsColorModalClose) {
                _lsColorModalClose.addEventListener('click', ()=>{
                    hideColorModal();
                });
            }
            if (_lsColorModalHeader && _lsColorModal) {
                _lsColorModalHeader.addEventListener('pointerdown', (ev)=>{
                    if (!_lsColorModal) return;
                    const rect = _lsColorModal.getBoundingClientRect();
                    _lsColorModalDrag = {
                        id: ev.pointerId,
                        startX: ev.clientX,
                        startY: ev.clientY,
                        originLeft: rect.left,
                        originTop: rect.top
                    };
                    try{ _lsColorModalHeader.setPointerCapture(ev.pointerId); }catch(e){}
                });
                _lsColorModalHeader.addEventListener('pointermove', (ev)=>{
                    if (!_lsColorModalDrag || !_lsColorModal) return;
                    if (ev.pointerId !== _lsColorModalDrag.id) return;
                    const dx = ev.clientX - _lsColorModalDrag.startX;
                    const dy = ev.clientY - _lsColorModalDrag.startY;
                    const left = _lsColorModalDrag.originLeft + dx;
                    const top = _lsColorModalDrag.originTop + dy;
                    _lsColorModal.style.left = left + 'px';
                    _lsColorModal.style.top = top + 'px';
                    _lsColorModal.style.transform = 'translate(0, 0)';
                });
                _lsColorModalHeader.addEventListener('pointerup', (ev)=>{
                    if (!_lsColorModalDrag) return;
                    if (ev.pointerId !== _lsColorModalDrag.id) return;
                    try{ _lsColorModalHeader.releasePointerCapture(ev.pointerId); }catch(e){}
                    _lsColorModalDrag = null;
                });
            }
            if (_lsColorSpectrum && _lsColorSpectrumCtx) {
                const handlePick = (ev)=>{
                    if (!_lsColorSpectrum || !_lsColorSpectrumCtx || !_lsColorActive) return;
                    const rect = _lsColorSpectrum.getBoundingClientRect();
                    const x = Math.max(0, Math.min(rect.width - 1, ev.clientX - rect.left));
                    const y = Math.max(0, Math.min(rect.height - 1, ev.clientY - rect.top));
                    const data = _lsColorSpectrumCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
                    const hex = rgbToHex({ r: data[0], g: data[1], b: data[2] });
                    if (_lsColorPreview) {
                        try{ _lsColorPreview.style.background = hex; }catch(e){}
                    }
                    if (_lsColorActive.applyHex) {
                        _lsColorActive.applyHex(hex);
                    }
                };
                _lsColorSpectrum.addEventListener('pointerdown', (ev)=>{
                    if (!_lsColorSpectrum) return;
                    _lsColorDragState = { id: ev.pointerId };
                    try{ _lsColorSpectrum.setPointerCapture(ev.pointerId); }catch(e){}
                    handlePick(ev);
                });
                _lsColorSpectrum.addEventListener('pointermove', (ev)=>{
                    if (!_lsColorDragState) return;
                    if (ev.pointerId !== _lsColorDragState.id) return;
                    handlePick(ev);
                });
                _lsColorSpectrum.addEventListener('pointerup', (ev)=>{
                    if (!_lsColorDragState) return;
                    if (ev.pointerId !== _lsColorDragState.id) return;
                    try{ _lsColorSpectrum.releasePointerCapture(ev.pointerId); }catch(e){}
                    _lsColorDragState = null;
                });
            }
        }
        if (!_lsColorModalBackdrop || !_lsColorModal || !_lsColorSpectrumCtx || !_lsColorSpectrum) return;
        _lsColorActive = {
            native,
            applyHex: (hex)=>applyHex(hex, { push: true, fire: true })
        };
        const base = normalizeHexColor(native.value, '#000000');
        if (_lsColorPreview) {
            try{ _lsColorPreview.style.background = base; }catch(e){}
        }
        try{
            _lsUpdateModalControls(base, { push: false });
            _lsRenderRecentColors();
        }catch(e){}
        const w = _lsColorSpectrum.width || 260;
        const h = _lsColorSpectrum.height || 160;
        const g1 = _lsColorSpectrumCtx.createLinearGradient(0, 0, w, 0);
        g1.addColorStop(0, '#ff0000');
        g1.addColorStop(1 / 6, '#ffff00');
        g1.addColorStop(2 / 6, '#00ff00');
        g1.addColorStop(3 / 6, '#00ffff');
        g1.addColorStop(4 / 6, '#0000ff');
        g1.addColorStop(5 / 6, '#ff00ff');
        g1.addColorStop(1, '#ff0000');
        _lsColorSpectrumCtx.fillStyle = g1;
        _lsColorSpectrumCtx.fillRect(0, 0, w, h);
        const g2 = _lsColorSpectrumCtx.createLinearGradient(0, 0, 0, h);
        g2.addColorStop(0, 'rgba(255,255,255,1)');
        g2.addColorStop(0.5, 'rgba(255,255,255,0)');
        g2.addColorStop(1, 'rgba(0,0,0,1)');
        _lsColorSpectrumCtx.fillStyle = g2;
        _lsColorSpectrumCtx.fillRect(0, 0, w, h);
        _lsColorModalBackdrop.style.display = 'flex';
        _lsColorModal.style.left = '50%';
        _lsColorModal.style.top = '50%';
        _lsColorModal.style.transform = 'translate(-50%, -50%)';
    };

    swatch.addEventListener('click', ()=>{
        openModal();
    });

    native.addEventListener('input', ()=>{
        if (updating) return;
        applyHex(native.value, { push: true, fire: false });
    });

    applyHex(native.value, { push: false, fire: false });
}

// Core Toolbar Items Definition
const CORE_TOOLBAR_ITEMS = {
    'core:pointer': { name: '选择', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M5 3.059a1 1 0 0 1 1.636-.772l11.006 9.062c.724.596.302 1.772-.636 1.772h-5.592a1.5 1.5 0 0 0-1.134.518l-3.524 4.073c-.606.7-1.756.271-1.756-.655zm12.006 9.062L6 3.059v13.998l3.524-4.072a2.5 2.5 0 0 1 1.89-.864z"/></svg>' },
    'core:pen': { name: '画笔', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M17.18 2.926a2.975 2.975 0 0 0-4.26-.054l-9.375 9.375a2.44 2.44 0 0 0-.655 1.194l-.878 3.95a.5.5 0 0 0 .597.597l3.926-.873a2.5 2.5 0 0 0 1.234-.678l7.98-7.98l.337.336a1 1 0 0 1 0 1.414l-.94.94a.5.5 0 0 0 .708.706l.939-.94a2 2 0 0 0 0-2.828l-.336-.336l.67-.67a2.975 2.975 0 0 0 .052-4.153m-3.553.653a1.975 1.975 0 0 1 2.793 2.793L7.062 15.73a1.5 1.5 0 0 1-.744.409l-3.16.702l.708-3.183a1.43 1.43 0 0 1 .387-.704z"/></svg>' },
    'core:eraser': { name: '橡皮', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="m15.87 2.669l4.968 4.968a2.25 2.25 0 0 1 0 3.182l-8.682 8.68l6.098.001a.75.75 0 0 1 .743.648l.007.102a.75.75 0 0 1-.648.743l-.102.007l-8.41.001a2.24 2.24 0 0 1-1.714-.655l-4.969-4.969a2.25 2.25 0 0 1 0-3.182l9.527-9.526a2.25 2.25 0 0 1 3.182 0M5.708 11.768l-1.486 1.488a.75.75 0 0 0 0 1.06l4.969 4.969c.146.146.338.22.53.22l.029-.005l.038.002a.75.75 0 0 0 .463-.217l1.486-1.487zm8.04-8.039L6.77 10.707l6.03 6.03l6.979-6.978a.75.75 0 0 0 0-1.061L14.81 3.729a.75.75 0 0 0-1.06 0"/></svg>' },
    'core:video-booth': { name: '视频展台', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11zM10 15l-2.25-3l-1.75 2.26V10h8v4.5z"/></svg>' },
    'core:mode-toggle': { name: '模式切换', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M8.5 9A1.5 1.5 0 0 0 10 7.5v-4A1.5 1.5 0 0 0 8.5 2h-6A1.5 1.5 0 0 0 1 3.5v4a1.5 1.5 0 0 0 1 1.415l.019.006c.15.051.313.079.481.079zm6.75-3H11V5h4.25A2.75 2.75 0 0 1 18 7.75v6.5A2.75 2.75 0 0 1 15.25 17H4.75A2.75 2.75 0 0 1 2 14.25v-4.3q.243.05.5.05H3v4.25c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 17 14.25v-6.5A1.75 1.75 0 0 0 15.25 6M14 12.293l-2.646-2.647a.5.5 0 0 0-.708.708L13.293 13H11.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 .5-.497V10.5a.5.5 0 0 0-1 0z"/></svg>' },
    'core:feature-library': { name: '功能库', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M5.75 4A2.75 2.75 0 0 0 3 6.75v10.5A2.75 2.75 0 0 0 5.75 20h12.5A2.75 2.75 0 0 0 21 17.25V6.75A2.75 2.75 0 0 0 18.25 4zM4.5 6.75c0-.69.56-1.25 1.25-1.25h12.5c.69 0 1.25.56 1.25 1.25v10.5c0 .69-.56 1.25-1.25 1.25H5.75c-.69 0-1.25-.56-1.25-1.25z"/><path d="M8 8.25c0-.41.34-.75.75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 8 8.25m0 3c0-.41.34-.75.75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 8 11.25m0 3c0-.41.34-.75.75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 14.25"/></g></svg>' },
    'core:more': { name: '更多', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M4.5 17a1.5 1.5 0 0 1-1.493-1.355L3 15.501v-11a1.5 1.5 0 0 1 1.356-1.493L4.5 3H9a1.5 1.5 0 0 1 1.493 1.355l.007.145v.254l2.189-2.269a1.5 1.5 0 0 1 2.007-.138l.116.101l2.757 2.725a1.5 1.5 0 0 1 .111 2.011l-.103.116l-2.311 2.2h.234a1.5 1.5 0 0 1 1.493 1.356L17 11v4.5a1.5 1.5 0 0 1-1.355 1.493L15.5 17zm5-6.5H4v5a.5.5 0 0 0 .326.47l.084.023l.09.008h5zm6 0h-5V16h5a.5.5 0 0 0 .492-.41L16 15.5V11a.5.5 0 0 0-.41-.491zm-5-2.79V9.5h1.79zM9 4H4.5a.5.5 0 0 0-.492.411L4 4.501v5h5.5v-5a.5.5 0 0 0-.326-.469L9.09 4.01zm5.122-.826a.5.5 0 0 0-.645-.053l-.068.06l-2.616 2.713a.5.5 0 0 0-.057.623l.063.078l2.616 2.615a.5.5 0 0 0 .62.07l.078-.061l2.758-2.627a.5.5 0 0 0 .054-.638l-.059-.069z"/></svg>' },
    'core:collapse': { name: '折叠', icon: '⋯' },
    'core:undo': { name: '撤销', icon: '⤺' },
    'core:redo': { name: '重做', icon: '⤻' }
};

// Range inputs and their display text
const rangeInputs = [
    { input: 'optPenTailIntensity', text: 'penTailIntensityText', unit: '%' },
    { input: 'optPenTailSamplePoints', text: 'penTailSamplePointsText', unit: '' },
    { input: 'optPenTailSpeedSensitivity', text: 'penTailSpeedText', unit: '%' },
    { input: 'optPenTailPressureSensitivity', text: 'penTailPressureText', unit: '%' },
    { input: 'optMicaIntensity', text: 'micaIntensityText', unit: '%' }
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    installHyperOsButtonInteractions(document);
    installHyperOs3Controls(document);
    initTabs();
    initWindowControls();
    initColorPickers();
    initRangeInputs();
    initThemeLogic();
    initPenTailLogic();
    initPluginLogic();
    initToolbarLogic();
    initSettingsHistory();
    loadCurrentSettings();
    try{
        document.querySelectorAll('input[type="range"]').forEach(el=>{
            try{ el.dispatchEvent(new Event('input', { bubbles: true })); }catch(e){}
        });
    }catch(e){}
    try{
        document.querySelectorAll('input[type="color"]').forEach(el=>{
            try{ el.dispatchEvent(new Event('input', { bubbles: true })); }catch(e){}
        });
    }catch(e){}
});

// Theme Logic
function initThemeLogic() {
    const themeSelect = document.getElementById('optTheme');
    const primaryInput = document.getElementById('optThemePrimary');
    const backgroundInput = document.getElementById('optThemeBackground');
    const designLanguageSelect = document.getElementById('optDesignLanguage');
    const visualStyleSelect = document.getElementById('optVisualStyle');
    const micaIntensityInput = document.getElementById('optMicaIntensity');
    
    const exportBtn = document.getElementById('exportThemeBtn');
    const importBtn = document.getElementById('importThemeBtn');
    const resetBtn = document.getElementById('resetThemeBtn');
    const fileInput = document.getElementById('themeFileInput');
    const contrastBtn = document.getElementById('contrastReportBtn');
    
    if (!themeSelect) return;

    updateThemePreview = () => {
        const theme = themeSelect.value;
        const custom = {
            primary: primaryInput.value,
            background: backgroundInput.value
        };
        const settings = {
            theme,
            themeCustom: custom,
            mica: { intensity: parseInt(micaIntensityInput.value) },
            designLanguage: designLanguageSelect?.value || 'fluent',
            visualStyle: visualStyleSelect?.value || 'solid'
        };

        // Apply to settings window for real-time feedback
        applyThemeMode(theme, settings, document.documentElement);
        
        // Update contrast report
        renderThemePreview(theme, custom);
    };

    themeSelect.addEventListener('change', updateThemePreview);
    if (primaryInput) primaryInput.addEventListener('input', updateThemePreview);
    if (backgroundInput) backgroundInput.addEventListener('input', updateThemePreview);
    if (designLanguageSelect) designLanguageSelect.addEventListener('change', updateThemePreview);
    if (visualStyleSelect) visualStyleSelect.addEventListener('change', updateThemePreview);
    if (micaIntensityInput) micaIntensityInput.addEventListener('input', updateThemePreview);

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const themeData = {
                theme: themeSelect.value,
                themeCustom: {
                    primary: primaryInput.value,
                    background: backgroundInput.value
                }
            };
            const blob = new Blob([JSON.stringify(themeData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'theme.lantheme';
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.theme) setValue('optTheme', data.theme);
                    if (data.themeCustom?.primary) setValue('optThemePrimary', data.themeCustom.primary);
                    if (data.themeCustom?.background) setValue('optThemeBackground', data.themeCustom.background);
                    if (updateThemePreview) updateThemePreview();
                } catch (err) {
                    console.error('Failed to import theme:', err);
                }
            };
            reader.readAsText(file);
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            setValue('optTheme', 'system');
            setValue('optThemePrimary', '#2B7CFF');
            setValue('optThemeBackground', '#FFFFFF');
            setValue('optMicaIntensity', 60);
            if (updateThemePreview) updateThemePreview();
        });
    }

    if (contrastBtn) {
        contrastBtn.addEventListener('click', () => {
            if (updateThemePreview) updateThemePreview();
        });
    }

    const perfBtn = document.getElementById('perfCheckBtn');
    if (perfBtn) {
        perfBtn.addEventListener('click', () => {
            const start = performance.now();
            let count = 0;
            const end = start + 100; // Check for 100ms
            while (performance.now() < end) {
                count++;
            }
            const duration = performance.now() - start;
            const opsPerMs = Math.round(count / duration);
            
            alert(`性能自检完成：\n- 算力评估: ${opsPerMs} units/ms\n- 内存占用: ${Math.round(performance.memory ? performance.memory.usedJSHeapSize / 1024 / 1024 : 0)} MB\n- 渲染引擎: ${navigator.userAgent.includes('Electron') ? 'Electron (Chromium)' : 'Browser'}`);
        });
    }

    // Listen for system theme changes
    const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
    darkMedia.addEventListener('change', () => {
        if (themeSelect.value === 'system' && updateThemePreview) {
            updateThemePreview();
        }
    });
}

function renderThemePreview(theme, custom) {
    if (!themePreviewReport) return;
    
    const report = buildContrastReport();
    themePreviewReport.innerHTML = report.map(item => `
        <div class="contrast-item" style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--ls-fluent-btn-border);">
            <span class="contrast-label">${item.name}</span>
            <span class="contrast-value ${item.okAA ? 'ok' : 'fail'}" style="color: ${item.okAA ? '#2e7d32' : '#d32f2f'}; font-weight: bold;">
                ${item.ratio || 'N/A'} : 1 
                <small style="font-weight: normal; margin-left: 4px;">${item.okAA ? '✓ 通过' : '⚠ 建议优化'}</small>
            </span>
        </div>
    `).join('');
}

// Pen Tail Logic
function initPenTailLogic() {
    const enabledCheck = document.getElementById('optPenTailEnabled');
    const intensityInput = document.getElementById('optPenTailIntensity');
    const profileSelect = document.getElementById('optPenTailProfile');
    const samplePointsInput = document.getElementById('optPenTailSamplePoints');
    const speedInput = document.getElementById('optPenTailSpeedSensitivity');
    const pressureInput = document.getElementById('optPenTailPressureSensitivity');
    const shapeSelect = document.getElementById('optPenTailShape');
    
    if (!enabledCheck || !intensityInput) return;

    updatePenTailPreview = () => {
        renderPenTailPreview({
            enabled: enabledCheck.checked,
            intensity: parseInt(intensityInput.value),
            samplePoints: parseInt(samplePointsInput?.value || 10),
            speedSensitivity: parseInt(speedInput?.value || 100),
            pressureSensitivity: parseInt(pressureInput?.value || 100),
            shape: shapeSelect?.value || 'sharp'
        });
    };

    const handleProfileChange = () => {
        const p = profileSelect.value;
        if (p === 'standard') {
            setValue('optPenTailIntensity', 50);
            setValue('optPenTailSamplePoints', 10);
            setValue('optPenTailSpeedSensitivity', 100);
            setValue('optPenTailPressureSensitivity', 100);
            setValue('optPenTailShape', 'sharp');
        } else if (p === 'calligraphy') {
            setValue('optPenTailIntensity', 80);
            setValue('optPenTailSamplePoints', 15);
            setValue('optPenTailSpeedSensitivity', 150);
            setValue('optPenTailPressureSensitivity', 120);
            setValue('optPenTailShape', 'natural');
        } else if (p === 'speed') {
            setValue('optPenTailIntensity', 30);
            setValue('optPenTailSamplePoints', 8);
            setValue('optPenTailSpeedSensitivity', 80);
            setValue('optPenTailPressureSensitivity', 150);
            setValue('optPenTailShape', 'round');
        }
        updatePenTailPreview();
        // Trigger label updates
        rangeInputs.forEach(ri => {
            const inputEl = document.getElementById(ri.input);
            const textEl = document.getElementById(ri.text);
            if (inputEl && textEl) textEl.textContent = `${inputEl.value}${ri.unit}`;
        });
    };

    enabledCheck.addEventListener('change', updatePenTailPreview);
    intensityInput.addEventListener('input', updatePenTailPreview);
    if (profileSelect) profileSelect.addEventListener('change', handleProfileChange);
    if (samplePointsInput) samplePointsInput.addEventListener('input', updatePenTailPreview);
    if (speedInput) speedInput.addEventListener('input', updatePenTailPreview);
    if (pressureInput) pressureInput.addEventListener('input', updatePenTailPreview);
    if (shapeSelect) shapeSelect.addEventListener('change', updatePenTailPreview);
}

function renderPenTailPreview(cfg) {
    if (!penTailPreview) return;
    const c = normalizePenTailSettings(cfg);
    const ctx = penTailPreview.getContext('2d');
    if (!ctx) return;

    const w = penTailPreview.width || 520;
    const h = penTailPreview.height || 150;
    ctx.clearRect(0, 0, w, h);

    if (!c.enabled) {
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('笔锋功能已禁用', w / 2, h / 2);
        return;
    }

    const baseSize = 6;
    const pts = [];
    const t0 = 0;
    // Generate a sample stroke (S-curve)
    for (let i = 0; i < 26; i++) {
        const u = i / 25;
        const x = 40 + u * (w - 80);
        const y = h * 0.5 + Math.sin(u * Math.PI * 1.5) * (h * 0.2);
        const dt = (i < 12) ? 16 : 8;
        const t = (i === 0) ? t0 : (pts[pts.length - 1].t + dt);
        const p = (i < 14) ? 0.2 + u * 0.6 : 0.8 - (u - 0.5) * 0.6;
        pts.push({ x, y, t, p: Math.max(0.05, Math.min(1, p)) });
    }

    const segRes = buildPenTailSegment(pts, baseSize, c);
    const outPts = segRes && Array.isArray(segRes.segment) ? segRes.segment : pts;

    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ls-sys-color-primary') || '#2B7CFF';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    for (let i = 1; i < outPts.length; i++) {
        const a = outPts[i - 1];
        const b = outPts[i];
        const lw = Math.max(0.2, Number((a && a.w) || (b && b.w) || baseSize) || baseSize);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
    ctx.restore();
}

// Plugin Logic
function initPluginLogic() {
    const installBtn = document.getElementById('pluginInstallBtn');
    const refreshBtn = document.getElementById('pluginRefreshBtn');
    const fileInput = document.getElementById('pluginFileInput');
    const dropZone = document.getElementById('pluginDropZone');
    const progress = document.getElementById('pluginInstallProgress');
    const status = document.getElementById('pluginInstallStatus');
    
    if (installBtn && fileInput) {
        installBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) handlePluginInstall(file);
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadPlugins);
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('active');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('active');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.lanmod')) {
                handlePluginInstall(file);
            }
        });
    }

    async function handlePluginInstall(file) {
        if (!file) return;
        if (progress) progress.style.display = 'block';
        if (status) status.textContent = '正在安装...';
        
        try {
            // In a real app, we'd need to get the file path
            // Since this is a renderer process, we might need an IPC call
            // For now, we'll simulate it if we don't have a path
            const res = await Mod.install(file.path || file.name);
            if (res && res.success) {
                if (status) status.textContent = '安装成功';
                loadPlugins();
            } else {
                if (status) status.textContent = `安装失败: ${res?.error || '未知错误'}`;
            }
        } catch (e) {
            if (status) status.textContent = `安装出错: ${e.message}`;
        } finally {
            if (progress) progress.style.display = 'none';
        }
    }
    
    loadPlugins();
}

// Toolbar Logic
function initToolbarLogic() {
    const layoutList = document.getElementById('toolbarLayoutList');
    const layoutPreview = document.getElementById('toolbarLayoutPreview');
    const resetBtn = document.getElementById('toolbarLayoutReset');

    if (!layoutList || !layoutPreview) return;

    let currentOrder = [];
    let hiddenIds = new Set();

    const persistLayout = (opts) => {
        const patch = {
            toolbarButtonOrder: currentOrder.slice(),
            toolbarButtonHidden: Array.from(hiddenIds)
        };
        try {
            const merged = updateAppSettings(patch, { history: { source: String(opts && opts.source || 'settings_window_toolbar') } });
            _requestSettingsChangedToMain(merged);
            try { _lastPersistedJSON = JSON.stringify(getSettingsFromUI()); } catch (e) { }
            if (merged && merged.__lsPersistOk === false) {
                if (typeof showToast === 'function') showToast('工具栏设置保存失败', 'error');
            } else if (opts && opts.toast && typeof showToast === 'function') {
                showToast(String(opts.toast), 'success');
            }
        } catch (e) {
            try { console.warn('[settings] toolbar persist failed', e); } catch (err) { }
            if (typeof showToast === 'function') showToast('工具栏设置保存失败', 'error');
        }
    };

    const updateFromSettings = () => {
        const s = loadSettings();
        const defaultOrder = [
            'core:pointer', 'core:pen', 'core:eraser', 'core:video-booth',
            'core:mode-toggle', 'core:feature-library', 'core:more',
            'core:collapse', 'core:undo', 'core:redo'
        ];
        
        currentOrder = Array.isArray(s.toolbarButtonOrder) && s.toolbarButtonOrder.length > 0 
            ? s.toolbarButtonOrder 
            : [...defaultOrder];
        
        hiddenIds = new Set(Array.isArray(s.toolbarButtonHidden) ? s.toolbarButtonHidden : []);
        render();
    };

    const render = () => {
        layoutList.innerHTML = currentOrder.map((id, index) => {
            const item = CORE_TOOLBAR_ITEMS[id] || { name: id, icon: '?' };
            const isHidden = hiddenIds.has(id);
            return `
                <div class="resource-item ${isHidden ? 'hidden' : ''}" draggable="true" data-id="${id}" data-index="${index}">
                    <span class="item-icon">${item.icon}</span>
                    <span class="item-name">${item.name}</span>
                    <button class="win-btn toggle-btn" data-id="${id}" title="${isHidden ? '显示' : '隐藏'}">
                        ${isHidden ? '👁' : 'Ø'}
                    </button>
                </div>
            `;
        }).join('');

        layoutPreview.innerHTML = currentOrder
            .filter(id => !hiddenIds.has(id))
            .map(id => {
                const item = CORE_TOOLBAR_ITEMS[id] || { name: id, icon: '?' };
                return `
                    <div class="preview-item" title="${item.name}">
                        ${item.icon}
                    </div>
                `;
            }).join('');
        
        // Bind toggle buttons
        layoutList.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.dataset.id;
                if (hiddenIds.has(id)) {
                    hiddenIds.delete(id);
                } else {
                    hiddenIds.add(id);
                }
                render();
                persistLayout({ source: 'settings_window_toolbar_toggle', toast: '已更新工具栏显示' });
            });
        });
    };

    layoutList.addEventListener('dragstart', (e) => {
        const index = e.target.closest('.resource-item')?.dataset.index;
        if (index !== undefined) {
            e.dataTransfer.setData('text/plain', index);
            e.target.closest('.resource-item').classList.add('dragging');
        }
    });

    layoutList.addEventListener('dragend', (e) => {
        e.target.closest('.resource-item')?.classList.remove('dragging');
    });

    layoutList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingEl = layoutList.querySelector('.dragging');
        if (!draggingEl) return;
        
        const afterElement = getDragAfterElement(layoutList, e.clientY, '.resource-item');
        if (afterElement == null) {
            layoutList.appendChild(draggingEl);
        } else {
            layoutList.insertBefore(draggingEl, afterElement);
        }
    });

    layoutList.addEventListener('drop', (e) => {
        e.preventDefault();
        // Rebuild order from DOM
        const newOrder = Array.from(layoutList.querySelectorAll('.resource-item'))
            .map(el => el.dataset.id);
        currentOrder = newOrder;
        render();
        persistLayout({ source: 'settings_window_toolbar_sort', toast: '已更新工具栏排序' });
    });

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const defaultOrder = [
                'core:pointer', 'core:pen', 'core:eraser', 'core:video-booth',
                'core:mode-toggle', 'core:feature-library', 'core:more',
                'core:collapse', 'core:undo', 'core:redo'
            ];
            currentOrder = [...defaultOrder];
            hiddenIds = new Set();
            render();
            persistLayout({ source: 'settings_window_toolbar_reset', toast: '已恢复默认布局' });
        });
    }

    // Expose for handleSave
    window.getToolbarLayoutData = () => ({
        order: currentOrder,
        hidden: Array.from(hiddenIds)
    });

    updateFromSettings();
    try { Message.on(EVENTS.SETTINGS_CHANGED, updateFromSettings); } catch (e) { }
    try {
        window.addEventListener('storage', (e) => {
            if (!e) return;
            if (e.key === 'appSettings') updateFromSettings();
        });
    } catch (e) { }
}

async function loadPlugins() {
    const pluginList = document.getElementById('pluginList');
    if (!pluginList) return;

    try {
        const res = await Mod.list();
        if (!res || !res.success) {
            pluginList.innerHTML = '<div class="empty-state">无法加载插件列表</div>';
            return;
        }

        const installed = Array.isArray(res.installed) ? res.installed : [];
        if (installed.length === 0) {
            pluginList.innerHTML = '<div class="empty-state">尚未安装任何插件</div>';
            return;
        }

        pluginList.innerHTML = installed.map((p, index) => {
            const m = p.manifest || {};
            return `
                <div class="plugin-item" draggable="true" data-id="${p.id}" data-index="${index}">
                    <div class="plugin-info">
                        <div class="plugin-name">${m.name || p.id} <span class="plugin-version">v${m.version || '0.0.0'}</span></div>
                        <div class="plugin-desc">${m.description || '无描述'}</div>
                        <div class="plugin-meta">作者: ${m.author || '未知'}</div>
                    </div>
                    <div class="plugin-actions">
                        <button class="plugin-action-btn ${p.enabled ? 'disable' : 'enable'}" onclick="handlePluginToggle('${p.id}', ${p.enabled})">
                            ${p.enabled ? '禁用' : '启用'}
                        </button>
                        <button class="plugin-action-btn uninstall" onclick="handlePluginUninstall('${p.id}')">卸载</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add drag-and-drop for plugins
        initPluginDragDrop(pluginList);
    } catch (e) {
        console.error('Failed to load plugins:', e);
        pluginList.innerHTML = '<div class="empty-state">加载插件时出错</div>';
    }
}

// Global handlers for plugin actions (called from inline onclick)
window.handlePluginToggle = async (id, currentEnabled) => {
    try {
        await Mod.enable(id, !currentEnabled);
        loadPlugins();
    } catch (e) {
        console.error('Failed to toggle plugin:', e);
    }
};

window.handlePluginUninstall = async (id) => {
    if (confirm(`确定要卸载插件 ${id} 吗？`)) {
        try {
            await Mod.uninstall(id);
            loadPlugins();
        } catch (e) {
            console.error('Failed to uninstall plugin:', e);
        }
    }
};

function initPluginDragDrop(container) {
    container.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.plugin-item');
        if (item) {
            item.classList.add('dragging');
            e.dataTransfer.setData('text/plain', item.dataset.index);
        }
    });

    container.addEventListener('dragend', (e) => {
        const item = e.target.closest('.plugin-item');
        if (item) item.classList.remove('dragging');
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingEl = container.querySelector('.dragging');
        if (!draggingEl) return;
        
        const afterElement = getDragAfterElement(container, e.clientY, '.plugin-item');
        if (afterElement == null) {
            container.appendChild(draggingEl);
        } else {
            container.insertBefore(draggingEl, afterElement);
        }
    });

    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggingEl = container.querySelector('.dragging');
        if (!draggingEl) return;

        const newOrder = Array.from(container.querySelectorAll('.plugin-item'))
            .map(el => el.dataset.id);
        
        try {
            // If Mod.reorder exists, use it
            if (typeof Mod.reorder === 'function') {
                await Mod.reorder(newOrder);
            }
            loadPlugins();
        } catch (err) {
            console.error('Failed to reorder plugins:', err);
        }
    });
}

function getDragAfterElement(container, y, selector) {
    const draggableElements = [...container.querySelectorAll(`${selector}:not(.dragging)`)];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

const _historyUi = {
    all: [],
    rendered: 0,
    pageSize: 60,
    selected: new Set(),
    timelineEl: null,
    metaEl: null,
    loadMoreBtn: null,
    selectAllBtn: null,
    undoSelectedBtn: null,
    clearBtn: null
};

function _formatTs(ts) {
    const d = new Date(Number(ts || 0));
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function _pathToJumpTarget(path) {
    const p = String(path || '');
    const root = p.split('.')[0] || '';
    if (!root) return { tab: 'general', id: '' };
    if (root === 'enableAutoResize') return { tab: 'general', id: 'optAutoResize' };
    if (root === 'toolbarCollapsed') return { tab: 'general', id: 'optCollapsed' };
    if (root === 'showTooltips') return { tab: 'general', id: 'optTooltips' };

    if (root === 'theme') return { tab: 'appearance', id: 'optTheme' };
    if (root === 'designLanguage') return { tab: 'appearance', id: 'optDesignLanguage' };
    if (root === 'visualStyle') return { tab: 'appearance', id: 'optVisualStyle' };
    if (root === 'canvasColor') return { tab: 'appearance', id: 'optCanvasColor' };
    if (root === 'pdfDefaultMode') return { tab: 'appearance', id: 'optPdfDefaultMode' };

    if (root === 'themeCustom') {
        const sub = p.slice('themeCustom.'.length);
        if (sub) return { tab: 'appearance', id: `optTheme${sub.charAt(0).toUpperCase()}${sub.slice(1)}` };
        return { tab: 'appearance', id: '' };
    }
    if (root === 'mica') {
        const sub = p.slice('mica.'.length);
        if (sub === 'intensity') return { tab: 'appearance', id: 'optMicaIntensity' };
        return { tab: 'appearance', id: '' };
    }

    if (root === 'multiTouchPen') return { tab: 'input', id: 'optMultiTouchPen' };
    if (root === 'overlayShapeEnabled') return { tab: 'input', id: 'optOverlayShape' };
    if (root === 'pageSwitchDraggable') return { tab: 'input', id: 'optPageSwitchDraggable' };
    if (root === 'annotationPenColor') return { tab: 'input', id: 'optAnnotationPenColor' };
    if (root === 'whiteboardPenColor') return { tab: 'input', id: 'optWhiteboardPenColor' };
    if (root === 'smartInkRecognition') return { tab: 'input', id: 'optSmartInk' };
    if (root === 'penTail') {
        const sub = p.slice('penTail.'.length);
        if (sub === 'enabled') return { tab: 'input', id: 'optPenTailEnabled' };
        if (sub === 'profile') return { tab: 'input', id: 'optPenTailProfile' };
        if (sub === 'intensity') return { tab: 'input', id: 'optPenTailIntensity' };
        if (sub === 'samplePoints') return { tab: 'input', id: 'optPenTailSamplePoints' };
        if (sub === 'speedSensitivity') return { tab: 'input', id: 'optPenTailSpeedSensitivity' };
        if (sub === 'pressureSensitivity') return { tab: 'input', id: 'optPenTailPressureSensitivity' };
        if (sub === 'shape') return { tab: 'input', id: 'optPenTailShape' };
        return { tab: 'input', id: '' };
    }

    if (root === 'shortcuts') {
        const sub = p.slice('shortcuts.'.length);
        if (sub === 'undo') return { tab: 'shortcuts', id: 'keyUndo' };
        if (sub === 'redo') return { tab: 'shortcuts', id: 'keyRedo' };
        return { tab: 'shortcuts', id: '' };
    }

    if (root === 'videoBoothEnabled') return { tab: 'toolbar', id: 'optVideoBoothEnabled' };
    if (root === 'toolbarButtonOrder' || root === 'toolbarButtonHidden') return { tab: 'toolbar', id: 'toolbarLayoutList' };
    if (root === 'pluginButtonDisplay') return { tab: 'plugins', id: 'pluginList' };

    return { tab: 'general', id: '' };
}

function _jumpToSettingPath(path) {
    const target = _pathToJumpTarget(path);
    const btn = document.querySelector(`.settings-tab[data-tab="${target.tab}"]`);
    if (btn) btn.click();
    if (!target.id) return;
    const el = document.getElementById(target.id);
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
    try {
        el.classList.add('ls-jump-highlight');
        setTimeout(() => { try { el.classList.remove('ls-jump-highlight'); } catch (e) { } }, 1200);
    } catch (e) { }
}

function _historyRenderMeta() {
    if (!_historyUi.metaEl) return;
    // Show total from cache if available, else current list
    const source = _historyFullCache.length > 0 ? _historyFullCache : _historyUi.all;
    const total = source.length;
    const undone = source.filter(r => r && r.undone).length;
    _historyUi.metaEl.textContent = `记录: ${total}  已撤回: ${undone}  已选择: ${_historyUi.selected.size}`;
}

// Optimized History Renderer with Virtualization (Chunking)
const _HISTORY_CHUNK_SIZE = 20;

function _throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

class HistoryChunkManager {
    constructor(container) {
        this.container = container;
        this.observer = new IntersectionObserver(this.onIntersect.bind(this), { rootMargin: '400px 0px' });
        this.chunks = new Map(); // index -> { el, height, isRendered }
        this.data = [];
    }

    setData(data) {
        this.data = data || [];
        this.renderPlaceholders();
    }

    appendData(newData) {
        if (!Array.isArray(newData) || newData.length === 0) return;
        const oldChunkCount = this.chunks.size;
        this.data = this.data.concat(newData);
        
        const newTotalChunkCount = Math.ceil(this.data.length / _HISTORY_CHUNK_SIZE);
        
        // If the last chunk was partial and is rendered, re-render it to include new data
        if (oldChunkCount > 0) {
            const lastIdx = oldChunkCount - 1;
            const chunk = this.chunks.get(lastIdx);
            if (chunk && chunk.isRendered) {
                this.renderChunk(lastIdx);
            }
        }

        // Add new chunks
        for (let i = oldChunkCount; i < newTotalChunkCount; i++) {
            const el = document.createElement('div');
            el.className = 'ls-history-chunk';
            el.dataset.index = i;
            el.style.minHeight = '1px';
            this.container.appendChild(el);
            this.observer.observe(el);
            this.chunks.set(i, { el, height: 0, isRendered: false });
        }
        
        // Ensure footer is at the end
        this.ensureFooter();
    }

    ensureFooter() {
        let footer = this.container.querySelector('.ls-history-footer-pad');
        if (!footer) {
            footer = document.createElement('div');
            footer.className = 'ls-history-footer-pad';
            footer.style.height = '20px';
            this.container.appendChild(footer);
        } else {
            this.container.appendChild(footer); // Move to end
        }
    }

    renderPlaceholders() {
        this.observer.disconnect();
        this.container.innerHTML = '';
        this.chunks.clear();

        const count = Math.ceil(this.data.length / _HISTORY_CHUNK_SIZE);
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'ls-history-chunk';
            el.dataset.index = i;
            // Initial estimate or stored? For now auto.
            // Min height to prevent all chunks overlapping and triggering at once
            el.style.minHeight = '1px'; 
            this.container.appendChild(el);
            this.observer.observe(el);
            this.chunks.set(i, { el, height: 0, isRendered: false });
        }
        
        this.ensureFooter();
    }

    onIntersect(entries) {
        for (const entry of entries) {
            const idx = Number(entry.target.dataset.index);
            const chunk = this.chunks.get(idx);
            if (!chunk) continue;

            if (entry.isIntersecting) {
                if (!chunk.isRendered) {
                    this.renderChunk(idx);
                }
            } else {
                // Unload if far away? For now, let's keep it simple:
                // Only unload if we have height measured.
                // To meet 30% memory reduction, we SHOULD unload.
                if (chunk.isRendered && chunk.height > 0) {
                    this.unloadChunk(idx);
                }
            }
        }
    }

    renderChunk(index) {
        const chunk = this.chunks.get(index);
        if (!chunk) return;

        const start = index * _HISTORY_CHUNK_SIZE;
        const end = Math.min(start + _HISTORY_CHUNK_SIZE, this.data.length);
        const frag = document.createDocumentFragment();

        for (let i = start; i < end; i++) {
            frag.appendChild(_buildHistoryItem(this.data[i]));
        }
        
        chunk.el.innerHTML = '';
        chunk.el.appendChild(frag);
        chunk.el.style.height = 'auto'; // Let content dictate height
        chunk.isRendered = true;
    }

    unloadChunk(index) {
        const chunk = this.chunks.get(index);
        if (!chunk) return;

        // Measure before unload
        const rect = chunk.el.getBoundingClientRect();
        if (rect.height > 0) chunk.height = rect.height;

        chunk.el.innerHTML = '';
        chunk.el.style.height = `${chunk.height}px`;
        chunk.isRendered = false;
    }
}

let _historyChunkManager = null;
let _historyFullCache = [];
let _historyLoadedCount = 0;
let _historyIsLoading = false;

function _historyRender(reset, append) {
    if (!_historyUi.timelineEl) return;
    
    // Initialize manager if needed
    if (!_historyChunkManager || reset) {
        _historyChunkManager = new HistoryChunkManager(_historyUi.timelineEl);
    }
    
    if (reset) {
        _historyChunkManager.setData(_historyUi.all);
    } else if (append) {
        // We assume _historyUi.all has been updated with new items at the end
        // But ChunkManager needs the *new* items only?
        // No, my appendData implementation expects the NEW items.
        // So I should pass them.
        // Wait, _historyUi.all is usually the source of truth.
        // If I update _historyUi.all outside, I should pass the diff.
        // Refactored flow: see _loadMoreHistory
    }
    
    _historyRenderMeta();
}

function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function _buildHistoryItem(rec) {
    const recId = String(rec && rec.id || '');
    const isUndone = rec && rec.undone;
    const changes = Array.isArray(rec && rec.changes) ? rec.changes : [];
    const ts = _formatTs(rec && rec.ts);
    const source = String(rec && rec.source || 'settings');
    const mainText = changes.length === 1 ? String(changes[0].path || '设置变更') : `${changes.length || 0} 项设置变更`;
    const isSelected = _historyUi.selected.has(recId);

    const changesHtml = changes.map(c => {
        const path = _escapeHtml(String(c && c.path || ''));
        const before = _escapeHtml(String(c && c.beforeText || ''));
        const after = _escapeHtml(String(c && c.afterText || ''));
        return `
            <div class="ls-history-diff-row">
                <button type="button" data-action="jump" data-path="${path}">
                    <div class="ls-history-diff-path">${path}</div>
                </button>
                <div class="ls-history-diff-values">${before} → ${after}</div>
            </div>
        `;
    }).join('');

    const item = document.createElement('div');
    item.className = 'ls-history-item';
    item.setAttribute('role', 'listitem');
    
    // Use innerHTML for faster rendering of complex structure
    item.innerHTML = `
        <div class="ls-history-card${isUndone ? ' is-undone' : ''}" data-id="${_escapeHtml(recId)}">
            <div class="ls-history-card-header">
                <div class="ls-history-card-title">
                    <div class="ls-history-time">${_escapeHtml(ts)}</div>
                    <div class="ls-history-main">${_escapeHtml(mainText)}</div>
                </div>
                <div class="ls-history-badges">
                    <div class="ls-history-badge">${_escapeHtml(source)}</div>
                    ${isUndone ? '<div class="ls-history-badge ls-history-badge-undone">已撤回</div>' : ''}
                </div>
            </div>
            <div class="ls-history-card-body">
                <div class="ls-history-diff">
                    ${changesHtml}
                </div>
                <div class="ls-history-actions">
                    <input type="checkbox" class="ls-history-select" data-id="${_escapeHtml(recId)}" ${isSelected ? 'checked' : ''} ${isUndone ? 'disabled' : ''}>
                    <button type="button" class="mode-btn" data-action="jump" data-path="${changes[0] ? _escapeHtml(String(changes[0].path || '')) : ''}">跳转</button>
                    <button type="button" class="mode-btn" data-action="undo" data-id="${_escapeHtml(recId)}" ${isUndone ? 'disabled' : ''}>撤回</button>
                </div>
            </div>
        </div>
    `;

    return item;
}

let _historyRefreshTimer = 0;
function _historyRefresh(opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    if (_historyRefreshTimer) clearTimeout(_historyRefreshTimer);
    _historyRefreshTimer = setTimeout(() => {
        const loadingEl = document.getElementById('settingsHistoryLoading');
        if (loadingEl) loadingEl.hidden = false;
        
        // Use setTimeout to allow UI to render mask
        setTimeout(() => {
            // Load full history
            _historyFullCache = loadSettingsHistory(5000);
            
            // Initial batch
            _historyLoadedCount = 100;
            _historyUi.all = _historyFullCache.slice(0, _historyLoadedCount);
            
            if (o.reset) _historyUi.selected.clear();
            _historyRenderMeta();
            
            const page = document.getElementById('page-history');
            const isActive = page && page.classList.contains('active');
            if (isActive) _historyRender(true);
            
            if (o.reloadSettings) loadCurrentSettings();
            
            if (loadingEl) loadingEl.hidden = true;
        }, 50);
    }, 50);
}

function _loadMoreHistory() {
    if (_historyIsLoading) return;
    if (_historyLoadedCount >= _historyFullCache.length) return;
    
    _historyIsLoading = true;
    const loadingEl = document.getElementById('settingsHistoryLoading');
    if (loadingEl) loadingEl.hidden = false;
    
    setTimeout(() => {
        const nextBatch = _historyFullCache.slice(_historyLoadedCount, _historyLoadedCount + 100);
        if (nextBatch.length > 0) {
            _historyLoadedCount += nextBatch.length;
            _historyUi.all = _historyUi.all.concat(nextBatch);
            
            if (_historyChunkManager) {
                _historyChunkManager.appendData(nextBatch);
            }
            _historyRenderMeta();
        }
        
        if (loadingEl) loadingEl.hidden = true;
        _historyIsLoading = false;
    }, 50); // Simulate network/processing delay if needed, or just yield to UI
}

function initSettingsHistory() {
    _historyUi.timelineEl = document.getElementById('settingsHistoryTimeline');
    if (!_historyUi.timelineEl) return;
    _historyUi.metaEl = document.getElementById('settingsHistoryMeta');
    _historyUi.loadMoreBtn = document.getElementById('historyLoadMoreBtn');
    _historyUi.selectAllBtn = document.getElementById('historySelectAllBtn');
    _historyUi.undoSelectedBtn = document.getElementById('historyUndoSelectedBtn');
    _historyUi.clearBtn = document.getElementById('historyClearBtn');
    _historyUi.loadingEl = document.getElementById('settingsHistoryLoading');
    
    // Hide Load More button as we use infinite scrolling
    if (_historyUi.loadMoreBtn) _historyUi.loadMoreBtn.style.display = 'none';

    // Infinite Scroll Listener
    _historyUi.timelineEl.addEventListener('scroll', _throttle(() => {
        const el = _historyUi.timelineEl;
        // Load more when user scrolls to bottom (threshold 200px)
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
            _loadMoreHistory();
        }
    }, 200));

    // Event Delegation for Timeline
    _historyUi.timelineEl.addEventListener('click', (e) => {
        const target = e.target;
        
        // Handle Checkbox
        if (target.matches('.ls-history-select')) {
            const id = target.dataset.id;
            if (!id) return;
            if (target.checked) _historyUi.selected.add(id);
            else _historyUi.selected.delete(id);
            _historyRenderMeta();
            e.stopPropagation();
            return;
        }

        // Handle Action Buttons (Jump/Undo) or Diff Rows
        const btn = target.closest('button');
        if (btn) {
            const action = btn.dataset.action;
            if (action === 'jump') {
                e.stopPropagation();
                _jumpToSettingPath(btn.dataset.path || '');
                return;
            }
            if (action === 'undo') {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (!id) return;
                if (!confirm('确定要撤回该次修改吗？')) return;
                try { undoSettingsHistoryEntry(id, { source: 'settings_window_history' }); } catch (err) { }
                _historyRefresh({ reset: true, reloadSettings: true });
                return;
            }
        }
        
        // Handle Card Expansion
        const header = target.closest('.ls-history-card-header');
        if (header) {
            const card = header.closest('.ls-history-card');
            if (card) card.classList.toggle('expanded');
        }
    });

    if (_historyUi.selectAllBtn) {
        _historyUi.selectAllBtn.addEventListener('click', () => {
            // Use full cache for selection if available, otherwise fallback to loaded items
            const source = _historyFullCache.length > 0 ? _historyFullCache : _historyUi.all;
            const selectable = source.filter(r => r && !r.undone).map(r => String(r.id || '')).filter(Boolean);
            
            const allSelected = selectable.length && selectable.every(id => _historyUi.selected.has(id));
            if (allSelected) _historyUi.selected.clear();
            else for (const id of selectable) _historyUi.selected.add(id);
            
            // Update visible checkboxes only
            try {
                _historyUi.timelineEl.querySelectorAll('input.ls-history-select').forEach(cb => {
                    if (cb.disabled) return;
                    cb.checked = _historyUi.selected.has(cb.dataset.id);
                });
            } catch (e) { }
            _historyRenderMeta();
        });
    }
    if (_historyUi.undoSelectedBtn) {
        _historyUi.undoSelectedBtn.addEventListener('click', () => {
            const ids = Array.from(_historyUi.selected);
            if (!ids.length) return;
            if (!confirm(`确定要撤回选中的 ${ids.length} 条记录吗？`)) return;
            try { undoSettingsHistoryBatch(ids, { source: 'settings_window_history_batch' }); } catch (e) { }
            _historyRefresh({ reset: true, reloadSettings: true });
        });
    }
    if (_historyUi.clearBtn) {
        _historyUi.clearBtn.addEventListener('click', () => {
            if (!confirm('确定要清空全部历史记录吗？')) return;
            try { clearSettingsHistory(); } catch (e) { }
            _historyRefresh({ reset: true });
        });
    }

    try { Message.on(EVENTS.SETTINGS_HISTORY_CHANGED, () => _historyRefresh({ reset: true })); } catch (e) { }
    try {
        window.addEventListener('storage', (e) => {
            if (!e) return;
            if (e.key === 'ls_settings_history_v1') _historyRefresh({ reset: true });
        });
    } catch (e) { }
    _historyRefresh({ reset: true });
}

// Tab switching logic
function initTabs() {
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            
            // Update active state of tabs
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update active state of pages
            pages.forEach(page => {
                if (page.id === `page-${targetTab}`) {
                    page.classList.add('active');
                } else {
                    page.classList.remove('active');
                }
            });

            // Special logic for certain tabs
            if (targetTab === 'plugins') {
                loadPlugins();
            }
            if (targetTab === 'history') {
                _historyRender(true);
            }

            // Scroll to top of content area
            settingsContainer.scrollTop = 0;
        });
    });
}

// Window control buttons
function initWindowControls() {
    closeBtn.addEventListener('click', () => {
        window.close();
    });

    cancelBtn.addEventListener('click', () => {
        window.close();
    });

    saveBtn.addEventListener('click', () => {
        handleSave();
    });

    if (closeWhiteboardBtn) {
        closeWhiteboardBtn.addEventListener('click', () => {
            if (window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
                window.electronAPI.invokeMain('message', 'app:quit', {});
            }
        });
    }
}

// Range input label updates
function initRangeInputs() {
    rangeInputs.forEach(({ input, text, unit }) => {
        const inputEl = document.getElementById(input);
        const textEl = document.getElementById(text);
        if (inputEl && textEl) {
            inputEl.addEventListener('input', () => {
                textEl.textContent = `${inputEl.value}${unit}`;
            });
        }
    });
}

// Load settings into form
function loadCurrentSettings() {
    const s = loadSettings();
    
    // General
    setCheckbox('optAutoResize', s.enableAutoResize);
    setCheckbox('optCollapsed', s.toolbarCollapsed);
    setCheckbox('optTooltips', s.showTooltips);

    // Appearance
    setValue('optTheme', s.theme);
    setValue('optDesignLanguage', s.designLanguage);
    setValue('optVisualStyle', s.visualStyle);
    setValue('optMicaIntensity', s.mica.intensity);
    setValue('optThemePrimary', s.themeCustom.primary);
    setValue('optThemeBackground', s.themeCustom.background);
    setValue('optCanvasColor', s.canvasColor);
    setValue('optPdfDefaultMode', s.pdfDefaultMode);

    // Input
    setCheckbox('optMultiTouchPen', s.multiTouchPen);
    setCheckbox('optPageSwitchDraggable', s.pageSwitchDraggable);
    setCheckbox('optOverlayShape', s.overlayShapeEnabled);
    setValue('optAnnotationPenColor', s.annotationPenColor);
    setCheckbox('optPenTailEnabled', s.penTail.enabled);
    setValue('optPenTailProfile', s.penTail.profile);
    setValue('optPenTailIntensity', s.penTail.intensity);
    setValue('optPenTailSamplePoints', s.penTail.samplePoints);
    setValue('optPenTailSpeedSensitivity', s.penTail.speedSensitivity);
    setValue('optPenTailPressureSensitivity', s.penTail.pressureSensitivity);
    setValue('optPenTailShape', s.penTail.shape);
    setCheckbox('optSmartInk', s.smartInkRecognition);

    // Shortcuts
    setValue('keyUndo', s.shortcuts.undo);
    setValue('keyRedo', s.shortcuts.redo);

    // Toolbar
    setCheckbox('optSeparateToolbarWindow', s.separateToolbarWindow);
    setCheckbox('optVideoBoothEnabled', s.videoBoothEnabled);

    // Update range input labels
    rangeInputs.forEach(({ input, text, unit }) => {
        const inputEl = document.getElementById(input);
        const textEl = document.getElementById(text);
        if (inputEl && textEl) {
            textEl.textContent = `${inputEl.value}${unit}`;
        }
    });

    // Initial previews
    if (updateThemePreview) updateThemePreview();
    if (updatePenTailPreview) updatePenTailPreview();

    // Store initial state for change detection
    // We use a slight delay to ensure all UI updates (like ranges) are settled
    setTimeout(() => {
        initialSettingsJSON = JSON.stringify(getSettingsFromUI());
        _lastPersistedJSON = initialSettingsJSON;
        if (!isChangeListenersInitialized) {
            initChangeListeners();
            isChangeListenersInitialized = true;
        }
    }, 100);
}

function _requestSettingsChangedToMain(merged){
    try{
        if (window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
            window.electronAPI.invokeMain('message', EVENTS.SETTINGS_CHANGED, merged);
        }
    }catch(e){}
}

function _autoSaveSettings(currentSettings, currentJSON){
    if (!currentJSON || currentJSON === _lastPersistedJSON) return;
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
        _autoSaveTimer = 0;
        try{
            const merged = updateAppSettings(currentSettings, { history: { skipRecord: true, source: 'settings_window_autosave' } });
        _requestSettingsChangedToMain(merged);
        _lastPersistedJSON = currentJSON;
        
        // Show auto-save feedback if needed (subtle)
        // const saveIndicator = document.getElementById('saveIndicator');
        // if (saveIndicator) { ... }
        
        // Use Toast from ui-bootstrap (if available) or settings window specific toast
        if (typeof showToast === 'function') {
           // We might want to be less intrusive for auto-save, maybe only on error?
           // For now, let's just log or keep silent on success to avoid spamming
        }
    }catch(e){
        try{ console.warn('[settings] autosave failed', e); }catch(err){}
        if (typeof showToast === 'function') {
             showToast('自动保存失败', 'error');
        }
    }
}, 250);
}

// Change Detection Logic
function initChangeListeners() {
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(el => {
        el.addEventListener('change', checkForChanges);
        el.addEventListener('input', checkForChanges);
    });

    // Special case for toolbar layout which uses custom logic
    const layoutList = document.getElementById('toolbarLayoutList');
    if (layoutList) {
        // Observer for DOM changes in list (drag drop) or click on toggle
        const observer = new MutationObserver(() => {
            // Debounce slightly
            setTimeout(checkForChanges, 50);
        });
        observer.observe(layoutList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) {
        restartBtn.addEventListener('click', handleRestart);
    }
}

function checkForChanges() {
    if (!initialSettingsJSON) return;
    
    // Debounce to avoid performance hit on rapid input
    if (window._checkChangeTimer) clearTimeout(window._checkChangeTimer);
    window._checkChangeTimer = setTimeout(() => {
        const currentSettings = getSettingsFromUI();
        const currentJSON = JSON.stringify(currentSettings);
        
        const notification = document.getElementById('restartNotification');
        if (notification) {
            if (currentJSON !== initialSettingsJSON) {
                notification.classList.add('show');
            } else {
                notification.classList.remove('show');
            }
        }

        _autoSaveSettings(currentSettings, currentJSON);
    }, 100);
}

function handleRestart() {
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) {
        restartBtn.textContent = '正在重启...';
        restartBtn.disabled = true;
    }

    const s = getSettingsFromUI();
    const merged = updateAppSettings(s, { history: { source: 'settings_window_restart' } });
    
    // Notify main process or other windows
    if (window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
        window.electronAPI.invokeMain('message', EVENTS.SETTINGS_CHANGED, merged);
        // Call restart IPC
        window.electronAPI.invokeMain('message', 'app:restart', {});
    }
}

// Save settings from form
function handleSave() {
    const s = getSettingsFromUI();
    const merged = updateAppSettings(s, { history: { source: 'settings_window_save' } });
    
    // Notify main process or other windows
    _requestSettingsChangedToMain(merged);
    try{ _lastPersistedJSON = JSON.stringify(s); }catch(e){}

    // Show feedback and close
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '已保存';
    saveBtn.disabled = true;
    
    // Also show toast for better feedback
    if (typeof showToast === 'function') {
        showToast('设置已保存', 'success');
    }
    
    setTimeout(() => {
        window.close();
    }, 500);
}

function getSettingsFromUI() {
    const currentSettings = loadSettings();
    const toInt = (v, fallback) => {
        const n = parseInt(String(v), 10);
        return Number.isFinite(n) ? n : fallback;
    };
    const s = {
        ...currentSettings,
        enableAutoResize: getCheckbox('optAutoResize'),
        toolbarCollapsed: getCheckbox('optCollapsed'),
        showTooltips: getCheckbox('optTooltips'),
        theme: getValue('optTheme'),
        designLanguage: getValue('optDesignLanguage'),
        visualStyle: getValue('optVisualStyle'),
        mica: {
            ...currentSettings.mica,
            intensity: toInt(getValue('optMicaIntensity'), Number(currentSettings.mica && currentSettings.mica.intensity) || 0)
        },
        themeCustom: {
            ...currentSettings.themeCustom,
            primary: getValue('optThemePrimary'),
            background: getValue('optThemeBackground')
        },
        canvasColor: getValue('optCanvasColor'),
        pdfDefaultMode: getValue('optPdfDefaultMode'),
        multiTouchPen: getCheckbox('optMultiTouchPen'),
        pageSwitchDraggable: getCheckbox('optPageSwitchDraggable'),
        overlayShapeEnabled: getCheckbox('optOverlayShape'),
        annotationPenColor: getValue('optAnnotationPenColor'),
        penTail: {
            enabled: getCheckbox('optPenTailEnabled'),
            profile: getValue('optPenTailProfile'),
            intensity: toInt(getValue('optPenTailIntensity'), Number(currentSettings.penTail && currentSettings.penTail.intensity) || 0),
            samplePoints: toInt(getValue('optPenTailSamplePoints'), Number(currentSettings.penTail && currentSettings.penTail.samplePoints) || 0),
            speedSensitivity: toInt(getValue('optPenTailSpeedSensitivity'), Number(currentSettings.penTail && currentSettings.penTail.speedSensitivity) || 0),
            pressureSensitivity: toInt(getValue('optPenTailPressureSensitivity'), Number(currentSettings.penTail && currentSettings.penTail.pressureSensitivity) || 0),
            shape: getValue('optPenTailShape')
        },
        smartInkRecognition: getCheckbox('optSmartInk'),
        shortcuts: {
            undo: getValue('keyUndo'),
            redo: getValue('keyRedo')
        },
        separateToolbarWindow: getCheckbox('optSeparateToolbarWindow'),
        videoBoothEnabled: getCheckbox('optVideoBoothEnabled')
    };

    // Add toolbar layout data
    if (typeof window.getToolbarLayoutData === 'function') {
        const layout = window.getToolbarLayoutData();
        s.toolbarButtonOrder = layout.order;
        s.toolbarButtonHidden = layout.hidden;
    }
    
    return s;
}

try{
    window.addEventListener('beforeunload', () => {
        try{
            const currentSettings = getSettingsFromUI();
            const currentJSON = JSON.stringify(currentSettings);
            if (currentJSON !== _lastPersistedJSON) {
                const merged = updateAppSettings(currentSettings, { history: { skipRecord: true, source: 'settings_window_beforeunload' } });
                _requestSettingsChangedToMain(merged);
                _lastPersistedJSON = currentJSON;
            }
        }catch(e){}
    });
}catch(e){}

// Helper functions
function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function setCheckbox(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

function getCheckbox(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}
