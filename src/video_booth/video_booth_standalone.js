import VideoBoothCore from './video_booth_core.js';

class VideoBoothStandalone {
    constructor() {
        this.core = new VideoBoothCore();
        this.video = document.getElementById('mainVideo');
        this.deviceSelect = document.getElementById('deviceSelect');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.recordBtn = document.getElementById('recordBtn');
        this.stopRecordBtn = document.getElementById('stopRecordBtn');
        this.screenshotBtn = document.getElementById('screenshotBtn');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.recordingStatus = document.getElementById('recordingStatus');
        this.recordingTime = document.getElementById('recordingTime');
        
        this.isRecording = false;
        this.recordStartTime = 0;
        this.recordTimer = null;

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadDevices();
        await this.startDefaultStream();
    }

    bindEvents() {
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.deviceSelect.addEventListener('change', (e) => this.switchDevice(e.target.value));
        this.recordBtn.addEventListener('click', () => this.startRecording());
        this.stopRecordBtn.addEventListener('click', () => this.stopRecording());
        this.screenshotBtn.addEventListener('click', () => this.takeScreenshot());
        this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

        // 窗口控制
        document.getElementById('minimizeBtn').addEventListener('click', () => {
            if (window.electronAPI) window.electronAPI.invokeMain('message', 'window:minimize');
            else console.log('Minimize');
        });
        document.getElementById('maximizeBtn').addEventListener('click', () => {
            if (window.electronAPI) window.electronAPI.invokeMain('message', 'window:maximize');
            else console.log('Maximize');
        });
        document.getElementById('closeBtn').addEventListener('click', () => {
            if (window.electronAPI) window.electronAPI.invokeMain('message', 'window:close');
            else window.close();
        });
    }

    async loadDevices() {
        const devices = await this.core.getDevices();
        this.deviceSelect.innerHTML = '';
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Camera ${this.deviceSelect.length + 1}`;
            this.deviceSelect.appendChild(option);
        });
    }

    async startDefaultStream() {
        try {
            const stream = await this.core.startStream();
            this.video.srcObject = stream;
            this.updatePlayPauseUI(true);
        } catch (error) {
            console.error('Failed to start default stream:', error);
            alert('无法启动摄像头，请检查权限设置。');
        }
    }

    async switchDevice(deviceId) {
        try {
            const stream = await this.core.switchDevice(deviceId);
            this.video.srcObject = stream;
            this.updatePlayPauseUI(true);
        } catch (error) {
            console.error('Failed to switch device:', error);
        }
    }

    togglePlayPause() {
        if (this.video.paused) {
            this.video.play();
            this.updatePlayPauseUI(true);
        } else {
            this.video.pause();
            this.updatePlayPauseUI(false);
        }
    }

    updatePlayPauseUI(isPlaying) {
        const playIcon = this.playPauseBtn.querySelector('.play-icon');
        const pauseIcon = this.playPauseBtn.querySelector('.pause-icon');
        if (isPlaying) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        } else {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    }

    startRecording() {
        if (this.isRecording) return;
        this.core.startRecording();
        this.isRecording = true;
        this.recordBtn.style.display = 'none';
        this.stopRecordBtn.style.display = 'block';
        this.recordingStatus.style.display = 'flex';
        
        this.recordStartTime = Date.now();
        this.updateRecordingTime();
        this.recordTimer = setInterval(() => this.updateRecordingTime(), 1000);
    }

    async stopRecording() {
        if (!this.isRecording) return;
        const blob = await this.core.stopRecording();
        this.isRecording = false;
        this.recordBtn.style.display = 'block';
        this.stopRecordBtn.style.display = 'none';
        this.recordingStatus.style.display = 'none';
        
        clearInterval(this.recordTimer);
        
        if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `video_booth_record_${Date.now()}.webm`;
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    updateRecordingTime() {
        const elapsed = Math.floor((Date.now() - this.recordStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        this.recordingTime.textContent = `${minutes}:${seconds}`;
    }

    takeScreenshot() {
        const dataUrl = this.core.takeScreenshot(this.video);
        if (dataUrl) {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `video_booth_screenshot_${Date.now()}.png`;
            a.click();
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            document.exitFullscreen();
        }
    }
}

// 导出并在页面加载时初始化
export default VideoBoothStandalone;

document.addEventListener('DOMContentLoaded', () => {
    window.videoBooth = new VideoBoothStandalone();
});
