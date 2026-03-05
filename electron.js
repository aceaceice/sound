const { app, BrowserWindow, ipcMain, desktopCapturer } = require("electron");

// ... existing code ...

ipcMain.handle("get-desktop-sources", async () => {
  // fetch both screens and windows, but prioritize screens for global audio loopback
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    isScreen: s.id.startsWith("screen:"),
  }));
});
const path = require("path");
const SoundCheckNetwork = require("./network");
const os = require("os");

let mainWindow;
let network = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC handlers for audio streaming
ipcMain.handle("start-streaming", async (event, config) => {
  const { mode, port } = config;

  if (network) {
    network.stop();
  }

  network = new SoundCheckNetwork({
    port: port,
    isSender: mode === "sender",
    deviceName: `SoundCheck-${os.hostname().split(".")[0]}`,
    onAudioData: (data, rinfo) => {
      if (mainWindow) {
        mainWindow.webContents.send("audio-data", {
          data: data,
          address: rinfo.address,
          port: rinfo.port,
        });
      }
    },
    onDeviceFound: (device) => {
      if (mainWindow) {
        mainWindow.webContents.send("network-event", {
          type: "device-found",
          device,
        });
      }
    },
    onDeviceLost: (device) => {
      if (mainWindow) {
        mainWindow.webContents.send("network-event", {
          type: "device-lost",
          device,
        });
      }
    },
    onLatencyUpdate: (stats) => {
      if (mainWindow) {
        mainWindow.webContents.send("network-event", {
          type: "latency-update",
          stats,
        });
      }
    },
  });

  await network.start();

  return { success: true, mode, port, devices: network.getDiscoveredDevices() };
});

ipcMain.handle("stop-streaming", async () => {
  if (network) {
    network.stop();
    network = null;
  }
  return { success: true };
});

ipcMain.on("send-audio", (event, payload) => {
  if (network && network.isSender) {
    const { buffer } = payload;
    network.sendAudioData(buffer);
  }
});

ipcMain.on("subscribe-device", (event, payload) => {
  if (network && !network.isSender) {
    network.subscribeToSender(payload.ip, payload.port);
  }
});

ipcMain.on("unsubscribe-device", (event, payload) => {
  if (network && !network.isSender) {
    network.unsubscribeFromSender(payload.ip, payload.port);
  }
});
