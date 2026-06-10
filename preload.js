const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcRemote', {
  getInfo: () => ipcRenderer.invoke('get-remote-info'),
  onCommand: (callback) => {
    ipcRenderer.on('remote-command', (_event, cmd, payload) => callback(cmd, payload));
  }
});

contextBridge.exposeInMainWorld('pcWindow', {
  control: (action) => ipcRenderer.send('window-control', action)
});

contextBridge.exposeInMainWorld('pcDevice', {
  getId: () => ipcRenderer.invoke('get-device-id')
});

contextBridge.exposeInMainWorld('pcExternal', {
  open: (url) => ipcRenderer.invoke('open-external-url', url)
});
