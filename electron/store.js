/**
 * 主进程文档存储（userData/arena/*.json——共识 §二#5：JSON 文件×N + IPC，
 * 单实例单窗口无写冲突；写盘原子化 tmp+rename 防半截文件）。
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const path = (file) => join(dir, `${String(file).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  // 写锁（2026-11-07 审计轮2）：ipcMain.handle 并发 + 引擎侧 read-modify-write
  // 全量回写——同文件并发写会互踩丢更新（dds_chats 同款坑），按 file 串行排队
  const chains = new Map();
  const enqueue = (file, fn) => {
    const prev = chains.get(file) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(file, next);
    next.finally(() => { if (chains.get(file) === next) chains.delete(file); });
    return next;
  };
  return {
    read(file) {
      const p = path(file);
      if (!existsSync(p)) return null;
      try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
    },
    write(file, data) {
      return enqueue(file, () => {
        const p = path(file);
        const tmp = `${p}.tmp`;
        writeFileSync(tmp, JSON.stringify(data ?? null));
        renameSync(tmp, p);
        return true;
      });
    },
  };
}
