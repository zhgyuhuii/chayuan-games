/**
 * 主进程文档存储（userData/arena/*.json——共识 §二#5：JSON 文件×N + IPC，
 * 单实例单窗口无写冲突；写盘原子化 tmp+rename 防半截文件）。
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const path = (file) => join(dir, `${String(file).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  return {
    read(file) {
      const p = path(file);
      if (!existsSync(p)) return null;
      try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
    },
    write(file, data) {
      const p = path(file);
      const tmp = `${p}.tmp`;
      writeFileSync(tmp, JSON.stringify(data ?? null));
      renameSync(tmp, p);
      return true;
    },
  };
}
