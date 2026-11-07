/**
 * chayuan-game 主进程：单实例锁 + 主窗口 + 文档存储 IPC + 模型网关。
 * 安全基线（共识 §七#8）：contextIsolation、nodeIntegration=false、沙盒渲染；
 * 网关只绑 127.0.0.1 + token（query/Authorization 双通道，query 保 renderer
 * 引擎层 fetch URL 原样）。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createStore } from "./store.js";
import { startGateway } from "./gateway.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * userData 迁移：productName 变更（Chayuan Arena → 察元AI游戏）会换 userData
 * 目录——新目录缺 arena/config.json 而旧目录存在时整目录搬过来（保住已配
 * 厂商 key 与对局记录）。
 */
const migrateLegacyUserData = () => {
  try {
    const legacy = join(app.getPath("appData"), "Chayuan Arena", "arena");
    const cur = join(app.getPath("userData"), "arena");
    if (!existsSync(legacy)) return;
    if (existsSync(join(cur, "config.json"))) return; // 新目录已有数据，不动
    mkdirSync(cur, { recursive: true });
    for (const f of readdirSync(legacy)) copyFileSync(join(legacy, f), join(cur, f));
    console.log("[migrate] userData/arena <-", legacy);
  } catch (e) {
    console.warn("[migrate] skipped:", e?.message ?? e);
  }
};

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
      title: "察元AI游戏",
      backgroundColor: "#171a21",
      // 开发态窗口/任务栏图标（打包后 mac 走 icns、win 走 exe 内嵌 ico）
      ...(app.isPackaged ? {} : { icon: join(__dirname, "../build/icon.png") }),
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
    migrateLegacyUserData();
    // 开发态 Dock 图标（打包后由 icon.icns 接管）
    if (!app.isPackaged && process.platform === "darwin") {
      const dockPng = join(__dirname, "../build/icon.png");
      if (existsSync(dockPng)) app.dock?.setIcon(dockPng);
    }
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
