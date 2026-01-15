/**
 * PDF Viewer UI Logic
 */

let currentPath = '';
let currentMode = 'window'; // 'window' | 'fullscreen'
let canvas, ctx;
let isDrawing = false;
let strokes = []; // { points: [], size: 2, color: '#ff0000' }
let currentStroke = null;

const state = {
    penSize: 2,
    penColor: '#ff0000',
    penOpacity: 1
};

const PEN_STYLES = [
    { id: 'thin', name: '细笔', size: 2, color: '#ff0000', opacity: 1 },
    { id: 'medium', name: '中笔', size: 5, color: '#0000ff', opacity: 1 },
    { id: 'highlighter', name: '荧光笔', size: 12, color: '#ffff00', opacity: 0.4 }
];

async function init() {
    // 1. Get parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    currentPath = urlParams.get('path') || '';
    const initialMode = urlParams.get('mode') || 'window';

    if (!currentPath) {
        document.getElementById('pdf-filename').textContent = '未选择文件';
        return;
    }

    // 2. Set filename
    const filename = currentPath.split(/[\\/]/).pop();
    document.getElementById('pdf-filename').textContent = filename;

    // 3. Initialize Canvas
    canvas = document.getElementById('annotation-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // 4. Load PDF
    loadPdf(currentPath);

    // 5. Setup UI Events
    setupEvents();

    // 6. Set initial mode
    if (initialMode === 'fullscreen') {
        currentMode = 'fullscreen'; // Set before calling toggleMode logic if needed, but toggleMode toggles.
        // If initial is fullscreen, we want it to BE fullscreen.
        document.body.dataset.state = 'fullscreen';
        document.getElementById('btn-toggle-mode').querySelector('.btn-text').textContent = '退出至窗口化浏览';
        document.getElementById('annotation-toolbar').classList.remove('hidden');
        document.getElementById('pdf-backdrop').classList.add('hidden');
    } else {
        document.getElementById('pdf-backdrop').classList.remove('hidden');
    }
}

function loadPdf(path) {
    const container = document.getElementById('pdf-frame-container');
    // Using embed for native PDF viewer
    const embed = document.createElement('embed');
    embed.src = `${path}#toolbar=0&navpanes=0&scrollbar=1`;
    embed.type = 'application/pdf';
    container.appendChild(embed);
}

function setupEvents() {
    // Mode toggle
    document.getElementById('btn-toggle-mode').addEventListener('click', toggleMode);

    const closePdf = async () => {
        try {
            if (window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
                const res = await window.electronAPI.invokeMain('message', 'pdf:close-window', {});
                if (res && !res.success) {
                    console.error('Failed to close PDF window:', res.error);
                    alert('无法关闭窗口: ' + (res.error || '未知错误'));
                }
            } else {
                window.close();
            }
        } catch (e) {
            console.error('Error during closePdf:', e);
            alert('关闭窗口时发生错误');
        }
    };

    // Close button
    document.getElementById('btn-close').addEventListener('click', closePdf);

    // Backdrop click to close (only in window mode)
    document.getElementById('pdf-backdrop').addEventListener('click', () => {
        if (currentMode === 'window') closePdf();
    });

    // ESC key to close
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (currentMode === 'fullscreen') {
                toggleMode();
            } else {
                closePdf();
            }
        }
    });

    // Updated Pen style buttons logic
    const toolGroup = document.querySelector('.tool-group');
    if (toolGroup) {
        toolGroup.innerHTML = ''; // Clear existing
        PEN_STYLES.forEach(style => {
            const btn = document.createElement('button');
            btn.className = `tool-btn pen-style ${style.id === 'thin' ? 'active' : ''}`;
            btn.dataset.id = style.id;
            btn.textContent = style.name;
            btn.style.setProperty('--btn-color', style.color);
            btn.addEventListener('click', () => {
                document.querySelectorAll('.pen-style').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.penSize = style.size;
                state.penColor = style.color;
                state.penOpacity = style.opacity;
            });
            toolGroup.appendChild(btn);
        });
    }

    // Clear ink
    document.getElementById('btn-clear-ink').addEventListener('click', () => {
        strokes = [];
        redraw();
    });

    // Drawing events
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDrawing);
    canvas.addEventListener('mouseleave', endDrawing);

    // Touch support
    canvas.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        canvas.dispatchEvent(new MouseEvent('mouseup'));
    });
}

function toggleMode() {
    const previousMode = currentMode;
    currentMode = currentMode === 'window' ? 'fullscreen' : 'window';
    
    // Add a class for transition
    document.body.classList.add('mode-transitioning');
    
    document.body.dataset.state = currentMode;
    
    const btn = document.getElementById('btn-toggle-mode');
    const toolbar = document.getElementById('annotation-toolbar');
    const backdrop = document.getElementById('pdf-backdrop');

    if (currentMode === 'fullscreen') {
        btn.querySelector('.btn-text').textContent = '退出至窗口化浏览';
        btn.title = '退出全屏';
        toolbar.classList.remove('hidden');
        backdrop.classList.add('hidden'); // No backdrop in fullscreen
        if (window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
            window.electronAPI.invokeMain('message', 'pdf:set-fullscreen', true);
        }
    } else {
        btn.querySelector('.btn-text').textContent = '进入全屏批注';
        btn.title = '进入全屏批注';
        toolbar.classList.add('hidden');
        backdrop.classList.remove('hidden'); // Show backdrop in window mode
        if (window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
            window.electronAPI.invokeMain('message', 'pdf:set-fullscreen', false);
        }
    }

    // Handle animation duration (300ms)
    setTimeout(() => {
        document.body.classList.remove('mode-transitioning');
        resizeCanvas();
    }, 300);
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    redraw();
}

function startDrawing(e) {
    if (currentMode !== 'fullscreen') return;
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    currentStroke = {
        points: [{ x: e.clientX - rect.left, y: e.clientY - rect.top }],
        size: state.penSize,
        color: state.penColor,
        opacity: state.penOpacity
    };
}

function draw(e) {
    if (!isDrawing || !currentStroke) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    currentStroke.points.push({ x, y });
    
    redraw(); // Clear and redraw everything for opacity support
}

function endDrawing() {
    if (isDrawing && currentStroke) {
        strokes.push(currentStroke);
    }
    isDrawing = false;
    currentStroke = null;
}

function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const drawStroke = (stroke) => {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        // Handle opacity
        const color = stroke.color;
        const opacity = stroke.opacity || 1;
        
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.lineWidth = stroke.size;
        
        ctx.beginPath();
        const pts = stroke.points;
        if (pts.length < 2) return;
        
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    };

    strokes.forEach(drawStroke);
    if (currentStroke) drawStroke(currentStroke);
}

// Initial Call
init();
