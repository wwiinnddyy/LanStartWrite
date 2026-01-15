/**
 * VideoBoothCore - 视频展台核心逻辑
 * 处理媒体流采集、设备枚举及基本控制
 */
export default class VideoBoothCore {
  constructor() {
    this.stream = null;
    this.devices = [];
    this.currentDeviceId = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.constraints = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: false
    };
  }

  /**
   * 开始录制视频
   */
  startRecording() {
    if (!this.stream) return;
    this.recordedChunks = [];
    const options = { mimeType: 'video/webm;codecs=vp9,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      this.mediaRecorder.start();
      console.log('Recording started');
    } catch (e) {
      console.error('Exception while creating MediaRecorder:', e);
    }
  }

  /**
   * 停止录制并返回视频 Blob
   */
  stopRecording() {
    return new Promise((resolve) => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
          resolve(blob);
        };
        this.mediaRecorder.stop();
        console.log('Recording stopped');
      } else {
        resolve(null);
      }
    });
  }

  /**
   * 截取当前视频帧并返回 DataURL
   * @param {HTMLVideoElement} videoElement 
   */
  takeScreenshot(videoElement) {
    if (!videoElement || !this.stream) return null;
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  /**
   * 枚举所有视频输入设备
   */
  async getDevices() {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      this.devices = allDevices.filter(device => device.kind === 'videoinput');
      return this.devices;
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      return [];
    }
  }

  /**
   * 开启视频流
   * @param {string} deviceId 设备ID
   */
  async startStream(deviceId = null) {
    this.stopStream();
    
    const constraints = { ...this.constraints };
    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
      this.currentDeviceId = deviceId;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.stream;
    } catch (error) {
      console.error('Failed to get media stream:', error);
      throw error;
    }
  }

  /**
   * 停止视频流
   */
  stopStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  /**
   * 切换设备
   * @param {string} deviceId 
   */
  async switchDevice(deviceId) {
    return await this.startStream(deviceId);
  }

  /**
   * 获取当前流的分辨率
   */
  getSettings() {
    if (this.stream) {
      const track = this.stream.getVideoTracks()[0];
      return track ? track.getSettings() : null;
    }
    return null;
  }
}
