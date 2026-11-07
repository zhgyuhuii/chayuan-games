/**
 * 数据桥（chayuan-game 版）：与 harness dataClient 同 API（loadData/saveData/
 * subscribeDataChanged），后端换 Electron IPC（main 进程 userData JSON 文件，
 * electron/store.js）；无桥（测试/纯浏览器 dev）降级 localStorage。
 * harness 版的 shareDoc 房间文档面不适用（无多端协同底座），不实现。
 */
const hasBridge = () => typeof window !== "undefined" && window.chaGame && typeof window.chaGame.readData === "function";

const lsKey = (file) => `chayuan-game:${file}`;

export async function loadData(file, fallback = null) {
  if (hasBridge()) {
    try {
      const envelope = await window.chaGame.readData(file);
      return envelope === null || envelope === undefined ? null : envelope.data;
    } catch (error) {
      console.warn(`[chayuan-game/data] read ${file} failed: ${error?.message ?? error}`);
      return null;
    }
  }
  try {
    const raw = localStorage.getItem(lsKey(file));
    return raw == null ? (typeof fallback === "function" ? fallback() : fallback ?? null) : JSON.parse(raw);
  } catch {
    return typeof fallback === "function" ? fallback() : fallback ?? null;
  }
}

export async function saveData(file, data, fallbackSaver = null) {
  if (hasBridge()) {
    await window.chaGame.writeData(file, data);
    return "store";
  }
  try {
    localStorage.setItem(lsKey(file), JSON.stringify(data));
  } catch { /* 配额/隐私模式：静默 */ }
  if (typeof fallbackSaver === "function") fallbackSaver(data);
  return "fallback";
}

/** 订阅数据变更（桥广播；localStorage 档同窗自发自收由调用方自理）。 */
export function subscribeDataChanged(file, listener) {
  if (hasBridge() && typeof window.chaGame.onDataChanged === "function") {
    return window.chaGame.onDataChanged(file, listener);
  }
  return () => {};
}
