/**
 * chayuan-game 主进程：单实例锁 + 主窗口 + 文档存储 IPC + 模型网关。
 * 安全基线（共识 §七#8）：contextIsolation、nodeIntegration=false、沙盒渲染；
 * 网关只绑 127.0.0.1 + token（query/Authorization 双通道，query 保 renderer
 * 引擎层 fetch URL 原样）。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";
import { startGateway } from "./gateway.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let store = null;
  let gateway = null;
  // 模型配置（userData/arena/config.json）——网关路由每次重读盘（2026-11-07
  // 真机 T6 实锤：启动时快照不感知外部/手动改盘 → 404 未配置命名空间）
  const readConfig = () => store?.read("config") ?? { vendors: [] };

  const broadcast = (file) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("chaGame:dataChanged", { file });
  };

  const createWindow = () => {
    win = new BrowserWindow({
      width: 1280, height: 840, minWidth: 980, minHeight: 640,
      title: "察元竞技场 · Chayuan Arena",
      backgroundColor: "#171a21",
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    if (process.env.CHAYUAN_DEV_URL) win.loadURL(process.env.CHAYUAN_DEV_URL);
    else win.loadFile(join(__dirname, "../dist/index.html"));
  };

  app.whenReady().then(async () => {
    store = createStore(join(app.getPath("userData"), "arena"));
    gateway = await startGateway({ getConfig: readConfig });

    ipcMain.handle("chaGame:readData", (_e, file) => store.read(file));
    ipcMain.handle("chaGame:writeData", (_e, file, data) => { store.write(file, data); broadcast(file); return true; });
    ipcMain.handle("chaGame:getGateway", () => ({ base: gateway.base, token: gateway.token }));
    ipcMain.handle("chaGame:getConfig", () => readConfig());
    ipcMain.handle("chaGame:saveConfig", (_e, next) => {
      store.write("config", { vendors: next && typeof next === "object" ? next.vendors ?? [] : [] });
      broadcast("config");
      return true;
    });

    createWindow();
    app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("quit", () => gateway?.close());
}
