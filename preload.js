const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    startStreaming: (config) => ipcRenderer.invoke('start-streaming', config),
    stopStreaming: () => ipcRenderer.invoke('stop-streaming'),
    subscribeDevice: (config) => ipcRenderer.send('subscribe-device', config),
    unsubscribeDevice: (config) => ipcRenderer.send('unsubscribe-device', config),

    onAudioData: (callback) => {
        ipcRenderer.on('audio-data', (event, data) => callback(data));
    },

    onNetworkEvent: (callback) => {
        ipcRenderer.on('network-event', (event, data) => callback(data));
    },

    sendAudioData: (data) => ipcRenderer.send('send-audio', data),
});
