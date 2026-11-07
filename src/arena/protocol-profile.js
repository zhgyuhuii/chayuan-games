/**
 * 模型协议画像（2026-11-06 P0 #11，收割当日实战教训）：每局每个「问题模型」
 * 都要重新交一遍学费（一次无 JSON → 试探 assistant 预填 → 被拒 → 行内续写…）。
 * 按 modelRef 持久化画像（os-data arena_protocol 文档），跨局直接从最优通道
 * 起步、两段思考能力直接复判：
 *   strong:    true/false/null —— 两段思考（分析+答案）是否成立（null 未知）
 *   primeBroken / inlineBroken: 网关对该模型的续写通道可用性
 * 写入 500ms 防抖合并落盘；读失败静默降级为无画像（会话内缓存仍可用）。
 */
// 宿主存储（2026-11-07 摘建审计裁决：依赖注入——runner/画像回归纯引擎，chayuan-game
// 同构为真）：harness 侧由 app/Arena/index.jsx 注入 { load, save }（dataClient os-data
// 桥）；chayuan-game 侧注入 IPC 版；null = 纯内存会话缓存（测试/降级档）。
let store = null;
export function setProtocolProfileStore(s) { store = s ?? null; }

const DOC = "arena_protocol";
const cache = new Map();
let loaded = false;
let persistTimer = null;

export async function loadProtocolProfiles() {
  try {
    const doc = store ? await store.load(DOC) : null;
    for (const [k, v] of Object.entries(doc?.profiles ?? {})) cache.set(k, v);
  } catch { /* 存储不可用：无画像开局（不阻塞对局） */ }
  loaded = true;
}

export async function getProtocolProfile(modelRef) {
  if (!loaded) await loadProtocolProfiles();
  return cache.get(modelRef) ?? null;
}

export function updateProtocolProfile(modelRef, patch) {
  const cur = cache.get(modelRef) ?? {};
  cache.set(modelRef, { ...cur, ...patch, lastAt: Date.now() });
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (store) void Promise.resolve(store.save(DOC, { profiles: Object.fromEntries(cache) })).catch(() => {});
  }, 500);
}

/** 测试用：清空会话缓存与已载标记。 */
export function __resetProtocolProfiles() {
  cache.clear();
  loaded = false;
  clearTimeout(persistTimer);
}
