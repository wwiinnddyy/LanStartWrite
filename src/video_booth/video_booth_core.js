/**
 * VideoBoothCore - 视频展台核心逻辑
 * 处理媒体流采集、设备枚举及基本控制
 */
export default class VideoBoothCore {
  constructor() {
    this.stream = null;
    this.devices = [];
    this.currentDeviceId = null;
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
