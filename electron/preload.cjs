// 预加载（CJS：sandbox 渲染进程要求）：contextBridge 暴露最小面。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chaGame", {
  readData: (file) => ipcRenderer.invoke("chaGame:readData", file),
  writeData: (file, data) => ipcRenderer.invoke("chaGame:writeData", file, data),
  onDataChanged: (file, listener) => {
    const wrapped = (_e, payload) => { if (payload?.file === file) listener(payload); };
    ipcRenderer.on("chaGame:dataChanged", wrapped);
    return () => ipcRenderer.removeListener("chaGame:dataChanged", wrapped);
  },
  getGateway: () => ipcRenderer.invoke("chaGame:getGateway"),
  getConfig: () => ipcRenderer.invoke("chaGame:getConfig"),
  saveConfig: (cfg) => ipcRenderer.invoke("chaGame:saveConfig", cfg),
});
