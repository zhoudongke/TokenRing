const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tokenRing", {
  getState: () => ipcRenderer.invoke("get-state"),
  openProvider: (provider) => ipcRenderer.invoke("open-provider", provider),
  windowAction: (action) => ipcRenderer.invoke("window-action", action),
  onUsageUpdated: (callback) => {
    ipcRenderer.on("usage-updated", (_event, state) => callback(state));
  }
});
