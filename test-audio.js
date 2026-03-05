const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');

app.whenReady().then(async () => {
    try {
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: false });
        console.log("Sources:", sources.map(s => s.name));
    } catch (e) {
        console.error(e);
    }
    app.quit();
});
