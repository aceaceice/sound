/**
 * Network module for low-latency UDP audio streaming
 * Handles device discovery and audio data transmission
 */

const dgram = require('dgram');
const os = require('os');

class SoundCheckNetwork {
  constructor(options = {}) {
    this.port = options.port || 4000;
    this.broadcastPort = options.broadcastPort || 4001;
    this.deviceName = options.deviceName || 'Unknown Device';
    this.isSender = options.isSender || false;
    this.onAudioData = options.onAudioData || (() => { });
    this.onDeviceFound = options.onDeviceFound || (() => { });
    this.onDeviceLost = options.onDeviceLost || (() => { });

    this.audioSocket = null;
    this.discoverySocket = null;
    this.knownDevices = new Map();
    this.discoveryInterval = null;

    // For senders: keep track of who asked for audio
    this.subscribers = new Set();
  }

  async start() {
    await this.startDiscovery();
    await this.startAudioServer(); // Both need a socket
  }

  async startDiscovery() {
    return new Promise((resolve, reject) => {
      try {
        this.discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.discoverySocket.on('message', (msg, rinfo) => {
          const message = msg.toString();

          if (message === 'DISCOVER') {
            this.broadcastPresence();
          } else if (message.startsWith('DEVICE:')) {
            const [, type, deviceName, ip, port] = message.split(':');
            const key = `${ip}:${port}`;
            this.knownDevices.set(key, {
              type,
              name: deviceName,
              ip,
              port: parseInt(port),
              lastSeen: Date.now()
            });
            this.onDeviceFound({ type, name: deviceName, ip, port: parseInt(port) });
          }
        });

        this.discoverySocket.bind(this.broadcastPort, () => {
          this.discoverySocket.setBroadcast(true);
          try { this.discoverySocket.setMulticastTTL(128); } catch (e) { }

          this.broadcastPresence();

          this.discoveryInterval = setInterval(() => {
            this.broadcastPresence();
            const now = Date.now();
            for (const [key, device] of this.knownDevices) {
              if (now - device.lastSeen > 10000) {
                this.knownDevices.delete(key);
                this.onDeviceLost(device);
              }
            }
          }, 3000);

          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  broadcastPresence() {
    const type = this.isSender ? 'SENDER' : 'RECEIVER';
    const message = `DEVICE:${type}:${this.deviceName}:${this.getLocalIP()}:${this.port}`;
    const buf = Buffer.from(message);

    try {
      this.discoverySocket.send(buf, 0, buf.length, this.broadcastPort, '255.255.255.255');
    } catch (err) {
      // Ignore broadcast errors
    }
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async startAudioServer() {
    return new Promise((resolve, reject) => {
      try {
        this.audioSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.audioSocket.on('message', (msg, rinfo) => {
          if (msg.toString() === 'SUBSCRIBE' && this.isSender) {
            this.subscribers.add(`${rinfo.address}:${rinfo.port}`);
            return;
          }
          if (msg.toString() === 'UNSUBSCRIBE' && this.isSender) {
            this.subscribers.delete(`${rinfo.address}:${rinfo.port}`);
            return;
          }

          // Fast path for audio data
          this.onAudioData(msg, rinfo);
        });

        this.audioSocket.bind(this.port, () => {
          console.log(`Audio socket bound on port ${this.port}`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  subscribeToSender(address, port) {
    if (this.audioSocket) {
      const buf = Buffer.from('SUBSCRIBE');
      this.audioSocket.send(buf, 0, buf.length, port, address);
    }
  }

  unsubscribeFromSender(address, port) {
    if (this.audioSocket) {
      const buf = Buffer.from('UNSUBSCRIBE');
      this.audioSocket.send(buf, 0, buf.length, port, address);
    }
  }

  sendAudioData(data) {
    if (!this.audioSocket || !this.isSender || this.subscribers.size === 0) return;

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    for (const sub of this.subscribers) {
      const [ip, port] = sub.split(':');
      try {
        this.audioSocket.send(buf, 0, buf.length, parseInt(port), ip);
      } catch (err) {
        // ignore send errors
      }
    }
  }

  getDiscoveredDevices() {
    return Array.from(this.knownDevices.values());
  }

  stop() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }
    if (this.discoverySocket) {
      try { this.discoverySocket.close(); } catch (e) { }
    }
    if (this.audioSocket) {
      try { this.audioSocket.close(); } catch (e) { }
    }
  }
}

module.exports = SoundCheckNetwork;