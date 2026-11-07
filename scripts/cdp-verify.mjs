/**
 * T3/T6 真机 UI 验证：CDP 驱动 electron 渲染进程——截图 + DOM 断言 + 主进程链路。
 * 用法：node scripts/cdp-verify.mjs [cdpPort]
 */
const port = process.argv[2] ?? "9223";
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === "page");
if (!page) throw new Error("no page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result ?? msg.error); pending.delete(msg.id); }
};
await new Promise((r) => (ws.onopen = r));

const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(800);

// ① 大厅渲染断言
const lobby = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-arena-game-card]')].map(e => e.getAttribute('data-arena-game-card'));
  return { app: !!document.querySelector('[data-cg-app]'), tabs: [...document.querySelectorAll('[data-cg-tab]')].map(e => e.textContent), cardCount: cards.length, cards: cards.slice(0, 6), modes: [...document.querySelectorAll('[data-arena-mode]')].length, startDisabled: document.querySelector('[data-arena-start]')?.disabled ?? null };
})()`);
console.log("[T3] 大厅:", JSON.stringify(lobby, null, 1));

// ② 主进程链路（bridge）：配置读取 + 网关发现 + 真实厂商模型拉取
const bridge = await evaluate(`(async () => {
  const b = window.chaGame;
  if (!b) return { bridge: false };
  const cfg = await b.getConfig();
  const gw = await b.getGateway();
  const r = await fetch(\`\${gw.base}/t/\${gw.token}/v1/models\`);
  const models = await r.json();
  return { bridge: true, vendors: (cfg.vendors ?? []).map(v => v.id), gatewayBase: gw.base, modelsHttp: r.status, modelCount: (models.data ?? []).length, firstModel: models.data?.[0]?.id };
})()`);
console.log("[T3] 桥+网关:", JSON.stringify(bridge, null, 1));

// ③ 配置页渲染（85 家目录）
await evaluate(`[...document.querySelectorAll('[data-cg-tab]')].find(e => e.getAttribute('data-cg-tab') === 'settings')?.click()`);
await sleep(400);
const settings = await evaluate(`(() => {
  const grid = [...document.querySelectorAll('[data-catalog-vendor]')].map(e => e.getAttribute('data-catalog-vendor'));
  const configured = [...document.querySelectorAll('[data-vendor-card]')].map(e => e.getAttribute('data-vendor-card'));
  return { catalogInPage: grid.length, configured, groups: [...document.querySelectorAll('[data-catalog-groups] button')].map(e => e.textContent) };
})()`);
console.log("[T3] 配置页(cn组):", JSON.stringify(settings, null, 1));

// ④ 大厅截图（回大厅再截）
await evaluate(`[...document.querySelectorAll('[data-cg-tab]')].find(e => e.getAttribute('data-cg-tab') === 'arena')?.click()`);
await sleep(500);
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 840, deviceScaleFactor: 1, mobile: false });
const shot = await send("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
writeFileSync("/tmp/cg-lobby.png", Buffer.from(shot.data, "base64"));
console.log("[T3] 截图 → /tmp/cg-lobby.png");
ws.close();
process.exit(0);
