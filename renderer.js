// SoundCheck Renderer Process - Frontend Logic
let currentMode = null;
let audioContext = null;
let mediaStream = null;
let audioSource = null;
let analyser = null;
let isStreaming = false;

let audioWorkletNode = null;
let nextPlayTime = 0;

const QUALITY_BITRATES = { low: 32000, medium: 64000, high: 128000 };

async function setMode(mode) {
    currentMode = mode;
    const senderBtn = document.getElementById('senderBtn');
    const receiverBtn = document.getElementById('receiverBtn');
    const senderPanel = document.getElementById('senderPanel');
    const receiverPanel = document.getElementById('receiverPanel');

    if (mode === 'sender') {
        senderBtn.classList.add('active', 'sender');
        receiverBtn.classList.remove('active', 'receiver');
        senderPanel.classList.remove('hidden');
        receiverPanel.classList.add('hidden');
        await initAudioCapture();
    } else if (mode === 'receiver') {
        receiverBtn.classList.add('active', 'receiver');
        senderBtn.classList.remove('active', 'sender');
        receiverPanel.classList.remove('hidden');
        senderPanel.classList.add('hidden');
        await scanForDevices();
    }
}

async function initAudioCapture() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        const select = document.getElementById('audioInput');
        select.innerHTML = audioInputs.map(d => `<option value="${d.deviceId}">${d.label || 'Microphone'}</option>`).join('');
    } catch (err) {
        console.error('Error enumerating audio devices:', err);
    }
}

async function scanForDevices() {
    const deviceList = document.getElementById('deviceList');
    deviceList.innerHTML = '<p style="color: #888;">Scanning for devices...</p>';
    await window.electronAPI.startStreaming({ mode: 'receiver', port: 0 });
}

window.electronAPI.onNetworkEvent((data) => {
    if (data.type === 'device-found' && data.device.type === 'SENDER' && currentMode === 'receiver') {
        const deviceList = document.getElementById('deviceList');
        if (deviceList.querySelector('p')) {
            deviceList.innerHTML = '';
        }

        const id = `device-${data.device.ip.replace(/\./g, '-')}-${data.device.port}`;
        const existing = document.getElementById(id);
        if (!existing) {
            const div = document.createElement('div');
            div.className = 'device-item';
            div.id = id;
            div.innerHTML = `
        <div class="device-info">
          <span class="device-name">${data.device.name}</span>
          <span class="device-ip">${data.device.ip}:${data.device.port}</span>
        </div>
        <button class="connect-btn connect" onclick="connectToDevice('${data.device.ip}', ${data.device.port})">Connect</button>
      `;
            deviceList.appendChild(div);
        }
    } else if (data.type === 'device-lost') {
        const id = `device-${data.device.ip.replace(/\./g, '-')}-${data.device.port}`;
        const existing = document.getElementById(id);
        if (existing) {
            existing.remove();
        }
    }
});

async function toggleStreaming() {
    if (isStreaming) {
        await stopStreaming();
    } else {
        await startStreaming();
    }
}

async function startStreaming() {
    const port = parseInt(document.getElementById('port').value);
    const audioInputId = document.getElementById('audioInput').value;

    try {
        await window.electronAPI.startStreaming({ mode: 'sender', port });

        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: audioInputId ? { exact: audioInputId } : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                latency: 0
            }
        });

        audioSource = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioSource.connect(analyser);

        await audioContext.audioWorklet.addModule('audio-processor.js');
        audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        audioSource.connect(audioWorkletNode);

        audioWorkletNode.port.onmessage = (event) => {
            if (isStreaming && event.data && event.data.type === 'audio') {
                window.electronAPI.sendAudioData({ buffer: event.data.data });
            }
        };

        updateStatus('streaming', 'Streaming audio...');
        isStreaming = true;
        document.getElementById('startBtn').textContent = 'Stop Streaming';
        document.getElementById('startBtn').classList.remove('start');
        document.getElementById('startBtn').classList.add('stop');
        startAudioLevelMeter();

    } catch (err) {
        console.error('Error starting audio stream:', err);
        updateStatus('error', 'Error: ' + err.message);
    }
}

async function stopStreaming() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        await audioContext.close();
    }
    await window.electronAPI.stopStreaming();
    isStreaming = false;
    document.getElementById('startBtn').textContent = 'Start Streaming';
    document.getElementById('startBtn').classList.remove('stop');
    document.getElementById('startBtn').classList.add('start');
    updateStatus('connected', 'Stopped');
}

function startAudioLevelMeter() {
    if (!analyser) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function updateLevel() {
        if (!isStreaming) {
            document.getElementById('audioLevel').style.width = '0%';
            return;
        }
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
        const percent = (average / 255) * 100;
        document.getElementById('audioLevel').style.width = percent + '%';
        requestAnimationFrame(updateLevel);
    }
    updateLevel();
}

let connectedSender = null;

async function connectToDevice(ip, port) {
    if (connectedSender) {
        window.electronAPI.unsubscribeDevice(connectedSender);
    }

    connectedSender = { ip, port };
    window.electronAPI.subscribeDevice(connectedSender);

    updateStatus('connected', `Connected to ${ip}:${port}`);

    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
}

window.electronAPI.onAudioData((payload) => {
    if (currentMode !== 'receiver' || !audioContext) return;

    const { data } = payload;

    const int16Array = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }

    const buffer = audioContext.createBuffer(1, float32Array.length, 48000);
    buffer.copyToChannel(float32Array, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const now = audioContext.currentTime;
    if (nextPlayTime < now) {
        nextPlayTime = now + 0.05;
    }
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
});

function updateStatus(status, text) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    indicator.className = 'status-indicator ' + status;
    statusText.textContent = text;
}

document.getElementById('senderBtn').addEventListener('click', () => setMode('sender'));
document.getElementById('receiverBtn').addEventListener('click', () => setMode('receiver'));
