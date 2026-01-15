import VideoBoothCore from './video_booth_core.js';
import { attachDragHelper } from '../drag_helper.js';

export default class VideoBoothUI {
  constructor() {
    this.core = new VideoBoothCore();
    this.container = null;
    this.video = null;
    this.controls = null;
    this._isVisible = false;
    
    // 注入 CSS
    this.injectStyles();
  }

  isVisible() {
    return this._isVisible;
  }

  injectStyles() {
    if (document.getElementById('video-booth-styles')) return;
    const link = document.createElement('link');
    link.id = 'video-booth-styles';
    link.rel = 'stylesheet';
    link.href = './video_booth/video_booth.css';
    document.head.appendChild(link);
  }

  /**
   * 初始化 UI 并添加到 DOM
   */
  init() {
    if (this.container) return;

    // 创建主容器
    this.container = document.createElement('div');
    this.container.id = 'videoBoothContainer';
    this.container.className = 'video-booth-window';
    this.container.style.display = 'none';

    // 创建标题栏 (拖动手柄)
    const titleBar = document.createElement('div');
    titleBar.className = 'video-booth-titlebar';
    titleBar.innerHTML = `
      <div class="video-booth-title">视频展台</div>
      <div class="video-booth-window-controls">
        <button class="win-btn minimize-btn" title="最小化">
          <svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M2 6h8v1H2z"/></svg>
        </button>
        <button class="win-btn close-btn" title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M2.22 2.22a.75.75 0 0 1 1.06 0L6 4.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L7.06 6l2.72 2.72a.75.75 0 1 1-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 0 1 0-1.06z"/></svg>
        </button>
      </div>
    `;

    // 创建视频区域
    const videoWrap = document.createElement('div');
    videoWrap.className = 'video-booth-wrap';
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    videoWrap.appendChild(this.video);

    // 创建控制条
    const controlBar = document.createElement('div');
    controlBar.className = 'video-booth-controls';
    controlBar.innerHTML = `
      <div class="control-group">
        <button class="ctrl-btn play-pause-btn" title="暂停/播放">
          <svg class="play-icon" width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M6 4v12l10-6z"/></svg>
          <svg class="pause-icon" width="20" height="20" viewBox="0 0 20 20" style="display:none"><path fill="currentColor" d="M6 4h3v12H6zm5 0h3v12h-3z"/></svg>
        </button>
        <select class="device-select" title="选择摄像头"></select>
      </div>
      <div class="control-group">
        <button class="ctrl-btn screenshot-btn" title="截屏到白板">
          <svg width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M10 12a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 1a3 3 0 1 1 0-6a3 3 0 0 1 0 6M5 5h2.5l1-1.5h3l1 1.5H15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2"/></svg>
        </button>
        <button class="ctrl-btn fullscreen-btn" title="全屏">
          <svg width="20" height="20" viewBox="0 0 20 20"><path fill="currentColor" d="M3 3h5v1H4v4H3zm14 0h-5v1h4v4h1zm0 14h-5v-1h4v-4h1zM3 17h5v-1H4v-4H3z"/></svg>
        </button>
      </div>
    `;

    this.container.appendChild(titleBar);
    this.container.appendChild(videoWrap);
    this.container.appendChild(controlBar);
    document.body.appendChild(this.container);

    this.bindEvents(titleBar, controlBar);
    this.initDraggable(titleBar);
  }

  /**
   * 绑定交互事件
   */
  bindEvents(titleBar, controlBar) {
    const closeBtn = titleBar.querySelector('.close-btn');
    const minimizeBtn = titleBar.querySelector('.minimize-btn');
    const playPauseBtn = controlBar.querySelector('.play-pause-btn');
    const playIcon = playPauseBtn.querySelector('.play-icon');
    const pauseIcon = playPauseBtn.querySelector('.pause-icon');
    const deviceSelect = controlBar.querySelector('.device-select');
    const screenshotBtn = controlBar.querySelector('.screenshot-btn');
    const fullscreenBtn = controlBar.querySelector('.fullscreen-btn');

    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.hide();
    };

    minimizeBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    };

    playPauseBtn.onclick = () => {
      if (this.video.paused) {
        this.video.play();
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
      } else {
        this.video.pause();
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
      }
    };

    deviceSelect.onchange = async () => {
      const deviceId = deviceSelect.value;
      try {
        const stream = await this.core.switchDevice(deviceId);
        this.video.srcObject = stream;
      } catch (err) {
        alert('切换设备失败: ' + err.message);
      }
    };

    fullscreenBtn.onclick = () => this.toggleFullscreen();

    screenshotBtn.onclick = () => this.takeScreenshot();
  }

  /**
   * 初始化拖动
   */
  initDraggable(handle) {
    attachDragHelper(handle, this.container, {
      clampRect: () => ({
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight
      })
    });
  }

  /**
   * 显示展台
   */
  async show() {
    this.init();
    this.container.style.display = 'flex';
    this._isVisible = true;

    try {
      const devices = await this.core.getDevices();
      const select = this.container.querySelector('.device-select');
      select.innerHTML = devices.map(d => `<option value="${d.deviceId}">${d.label || 'Camera ' + d.deviceId.slice(0, 5)}</option>`).join('');

      const stream = await this.core.startStream(devices[0]?.deviceId);
      this.video.srcObject = stream;
      
      // 更新播放状态图标
      const playIcon = this.container.querySelector('.play-icon');
      const pauseIcon = this.container.querySelector('.pause-icon');
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
    } catch (err) {
      console.error(err);
      alert('无法开启摄像头: ' + err.message);
    }
  }

  /**
   * 隐藏展台
   */
  hide() {
    if (this.container) {
      this.container.style.display = 'none';
      this.core.stopStream();
      this._isVisible = false;
    }
  }

  /**
   * 切换最小化
   */
  toggleMinimize() {
    if (this.container) {
      this.container.classList.toggle('minimized');
    }
  }

  /**
   * 切换全屏
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.container.requestFullscreen().catch(err => {
        alert(`无法进入全屏: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

  /**
   * 截屏并发送到白板 (此处需要与 renderer.js 协同)
   */
  takeScreenshot() {
    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/png');
    // 发送事件给白板，包含尺寸信息
    window.dispatchEvent(new CustomEvent('video-booth-screenshot', { 
      detail: { 
        dataUrl, 
        width: canvas.width, 
        height: canvas.height 
      } 
    }));
  }
}
