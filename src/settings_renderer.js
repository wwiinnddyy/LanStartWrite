import Settings, { loadSettings, saveSettings } from './setting.js';
import Message, { EVENTS } from './message.js';
import { buildPenTailSegment, normalizePenTailSettings } from './pen_tail.js';
import { applyThemeMode, buildContrastReport } from './colors_features.js';
import Mod from './mod.js';

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
    initTabs();
    initWindowControls();
    initRangeInputs();
    initThemeLogic();
    initPenTailLogic();
    initPluginLogic();
    initToolbarLogic();
    loadCurrentSettings();
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
        });
    }

    // Expose for handleSave
    window.getToolbarLayoutData = () => ({
        order: currentOrder,
        hidden: Array.from(hiddenIds)
    });

    updateFromSettings();
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
}

// Save settings from form
function handleSave() {
    const currentSettings = loadSettings();
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
            intensity: parseInt(getValue('optMicaIntensity'))
        },
        themeCustom: {
            ...currentSettings.themeCustom,
            primary: getValue('optThemePrimary'),
            background: getValue('optThemeBackground')
        },
        canvasColor: getValue('optCanvasColor'),
        pdfDefaultMode: getValue('optPdfDefaultMode'),
        multiTouchPen: getCheckbox('optMultiTouchPen'),
        annotationPenColor: getValue('optAnnotationPenColor'),
        penTail: {
            enabled: getCheckbox('optPenTailEnabled'),
            profile: getValue('optPenTailProfile'),
            intensity: parseInt(getValue('optPenTailIntensity')),
            samplePoints: parseInt(getValue('optPenTailSamplePoints')),
            speedSensitivity: parseInt(getValue('optPenTailSpeedSensitivity')),
            pressureSensitivity: parseInt(getValue('optPenTailPressureSensitivity')),
            shape: getValue('optPenTailShape')
        },
        smartInkRecognition: getCheckbox('optSmartInk'),
        shortcuts: {
            undo: getValue('keyUndo'),
            redo: getValue('keyRedo')
        },
        videoBoothEnabled: getCheckbox('optVideoBoothEnabled')
    };

    // Add toolbar layout data
    if (typeof window.getToolbarLayoutData === 'function') {
        const layout = window.getToolbarLayoutData();
        s.toolbarButtonOrder = layout.order;
        s.toolbarButtonHidden = layout.hidden;
    }

    saveSettings(s);
    
    // Notify main process or other windows
    if (window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
        window.electronAPI.invokeMain('message', EVENTS.SETTINGS_CHANGED, s);
    }

    // Show feedback and close
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '已保存';
    saveBtn.disabled = true;
    setTimeout(() => {
        window.close();
    }, 500);
}

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
