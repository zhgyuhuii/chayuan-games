/**
 * 模型注册表（chayuan-game 自建，共识 §二#14）：厂商卡（key/baseUrl/models
 * 手填）+ 网关发现 + useModelTree 同 shape 适配（Lobby/index 消费方零协议
 * 改动）。持久化走主进程 config.json（IPC），key 明文落 userData（预留
 * encrypted:// 前缀升级位——共识 #14）。
 */
import { useEffect, useState, useCallback } from "react";
import { VENDORS, VENDOR_BY_ID } from "../vendors/catalog.js";

const bridge = () => (typeof window !== "undefined" ? window.chaGame : null);

/** 保存配置（渲染层唯一写入口；带 encrypted:// 前缀的 key 原样透传不解析）。 */
export async function saveModelConfig(vendors) {
  const b = bridge();
  if (b) return b.saveConfig({ vendors });
  localStorage.setItem("chayuan-game:config", JSON.stringify({ vendors }));
  window.dispatchEvent(new CustomEvent("chaGame:configLocal"));
  return true;
}

/** 读配置（桥或 localStorage 降级）。 */
export async function readModelConfig() {
  const b = bridge();
  if (b) return (await b.getConfig()) ?? { vendors: [] };
  try { return JSON.parse(localStorage.getItem("chayuan-game:config") ?? '{"vendors":[]}'); } catch { return { vendors: [] }; }
}

/** 网关发现：桥 → 主进程 IPC（127.0.0.1 随机端口 + token）；无桥 dev 档 → vite 代理占位（真实转发不可用，仅 UI 预览）。 */
async function discoverGateway() {
  const b = bridge();
  if (b) {
    const g = await b.getGateway();
    return { base: g.base, proxyBase: `${g.base}/t/${g.token}` }; // token 走路径段（query 形式被引擎 URL 拼接吃掉——真机 T4 实锤）
  }
  return { base: "http://127.0.0.1:0", proxyBase: "http://127.0.0.1:0" };
}

/** useModelTree 同 shape 适配：{ leafValues, treeNodes, statusReady, proxyBase }。 */
export function useModelRegistry({ pollMs = 0 } = {}) {
  const [state, setState] = useState({ vendors: [], statusReady: false, proxyBase: "" });
  const reload = useCallback(async () => {
    const [cfg, gw] = await Promise.all([readModelConfig(), discoverGateway()]);
    setState({ vendors: cfg.vendors ?? [], statusReady: true, proxyBase: gw.proxyBase });
  }, []);
  useEffect(() => {
    void reload();
    if (pollMs > 0) {
      const t = setInterval(reload, pollMs);
      return () => clearInterval(t);
    }
  }, [reload, pollMs]);
  const enabled = state.vendors.filter((v) => v.enabled !== false && (v.models ?? []).length > 0);
  const treeNodes = enabled.map((v) => ({
    id: v.id,
    label: VENDOR_BY_ID.get(v.id)?.name ?? v.id,
    children: (v.models ?? []).map((m) => ({ id: `${v.id}/${m}`, value: `${v.id}/${m}` })),
  }));
  const leafValues = treeNodes.flatMap((n) => n.children.map((c) => c.value));
  return { ...state, treeNodes, leafValues, reload };
}

/** 测试连接：经网关对该厂商发 /v1/models（有 baseUrl）或直接报模型数。返回 { ok, msg }。 */
export async function testVendorConnection(vendorId) {
  const { proxyBase } = await discoverGateway();
  if (!proxyBase || proxyBase === "http://127.0.0.1:0") return { ok: false, msg: "网关未就绪（需在桌面应用内使用）" };
  try {
    const r = await fetch(`${proxyBase}/v1/models?vendor=${encodeURIComponent(vendorId)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, msg: data?.error?.message ?? `HTTP ${r.status}` };
    const n = (data.data ?? []).length;
    return { ok: true, msg: n > 0 ? `连通，${n} 个模型` : "连通（该厂商未列出模型，请手填）" };
  } catch (e) {
    return { ok: false, msg: e?.message ?? String(e) };
  }
}

/** 厂商目录按分组（设置页渲染用）。 */
export function catalogByGroup() {
  return ["cn", "global", "local", "agg"].map((g) => ({
    id: g,
    vendors: VENDORS.filter((v) => v.group === g),
  }));
}

export { VENDORS, VENDOR_BY_ID };

/** 网关 proxyBase（Room 解说等非 hook 场景；无桥/未就绪返回 null）。 */
export async function gatewayProxyBase() {
  const g = await discoverGateway();
  return g.proxyBase && g.proxyBase !== "http://127.0.0.1:0" ? g.proxyBase : null;
}
