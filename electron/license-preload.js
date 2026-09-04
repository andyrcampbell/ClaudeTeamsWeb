const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("license", {
  activate: (key) => ipcRenderer.invoke("license:activate", key),
  startTrial: () => ipcRenderer.invoke("license:start-trial"),
});
