/**
 * 真机 E2E（T4/T5）：真网关 + 桌面 key 真实厂商调用 + 端到端真实对局。
 * 用法：node scripts/real-e2e.mjs [--moves N]
 */
import { readFileSync } from "node:fs";
import { startGateway } from "../electron/gateway.js";
import { createGobangGame } from "../src/arena/games/gobang.js";
import { getGame } from "../src/arena/registry.js";
import { runMatch } from "../src/arena/match-runner.js";
import { createLlmPlayer } from "../src/arena/players.js";

// 桌面凭据（用户授权）：~/.dsh/.credentials.yaml refs → 多厂商候选逐个探测取活
const yamlText = readFileSync("/Users/zyh/.dsh/.credentials.yaml", "utf8");
const refOf = (name) => yamlText.split("\n").find((l) => l.includes(`${name}:`))?.split(":").slice(1).join(":").trim().replace(/["']/g, "");
const CANDIDATES = [
  { vendor: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.7-flash", keys: [refOf("ZHIPU_API_KEY"), refOf("CHATOP_ZHIPU_API_KEY")] },
  { vendor: "agnes", baseUrl: "https://api.agnes-ai.cn/v1", model: "agnes-text-flash", keys: [refOf("CHATOP_AGNES_API_KEY")] },
  { vendor: "moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5", keys: [refOf("CHATOP_MOONSHOT_API_KEY")] },
];
let active = null;
outer:
for (const c of CANDIDATES) {
  for (const k of c.keys.filter(Boolean)) {
    try {
      const r = await fetch(`${c.baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${k}` }, body: JSON.stringify({ model: c.model, max_tokens: 8, messages: [{ role: "user", content: "hi" }] }), signal: AbortSignal.timeout(25_000) });
      const body = await r.json().catch(() => ({}));
      console.log(`[T4] ${c.vendor}/${c.model} key ${k.slice(0, 8)}… → HTTP ${r.status}${r.ok ? "" : " " + JSON.stringify(body?.error ?? body).slice(0, 80)}`);
      if (r.ok) { active = { ...c, key: k }; break outer; }
    } catch (e) { console.log(`[T4] ${c.vendor} key ${k.slice(0, 8)}… → ${String(e).slice(0, 60)}`); }
  }
}
if (!active) throw new Error("桌面候选厂商 key 全部失效");
const key = active.key;
console.log(`[T4] key loaded: ${active.vendor}/${active.model} ${key.slice(0, 8)}…`);

const config = { vendors: [{ id: active.vendor, key, baseUrl: active.baseUrl, models: [active.model], enabled: true }] };
const gw = await startGateway({ getConfig: () => config });
const proxyBase = `${gw.base}/t/${gw.token}`;
console.log(`[T4] gateway up: ${gw.base} token=${gw.token.slice(0, 8)}…`);

// T4a：GET /v1/models（经真网关到 deepseek 真端点）
const mr = await fetch(`${proxyBase}/v1/models`);
const md = await mr.json();
console.log(`[T4a] /v1/models → HTTP ${mr.status}, models: ${(md.data ?? []).map((m) => m.id).join(", ")}`);

// T4b：POST /v1/chat/completions 真实补全
const cr = await fetch(`${proxyBase}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: `${active.vendor}/${active.model}`, max_tokens: 60, temperature: 0.6, messages: [{ role: "user", content: '只回一个 JSON：{"move":"H8","comment":"开局"}' }] }),
});
const cd = await cr.json();
console.log(`[T4b] chat → HTTP ${cr.status} usage=${JSON.stringify(cd.usage ?? {})} content=${JSON.stringify(cd.choices?.[0]?.message?.content)}`);

// T4c：token 鉴权负例
const nr = await fetch(`${gw.base}/v1/models`);
console.log(`[T4c] 无 token → HTTP ${nr.status}（期望 401）`);

// T5：端到端真实对局（五子棋 deepseek 自战，快棋档 320 tokens，防烧钱限步）
const maxMoves = Number(process.argv.includes("--moves") ? process.argv[process.argv.indexOf("--moves") + 1] : 8);
const gameDef = getGame("gobang");
const game = createGobangGame({ seed: 7 });
const modelRef = `${active.vendor}/${active.model}`;
const mk = () => createLlmPlayer({ modelRef, proxyBase, maxTokens: 320, thinkMode: false });
const events = [];
const p = runMatch({
  game, gameDef,
  players: [mk(), mk()],
  playerMeta: [
    { id: modelRef, label: active.model, kind: "llm", modelRef, cloud: true },
    { id: modelRef, label: active.model, kind: "llm", modelRef, cloud: true },
  ],
  mode: "ai_vs_ai", think: false, maxSteps: maxMoves,
  onEvent: (e) => { events.push(e); if (e.t === "move") console.log(`[T5] move#${e.seat} ${e.move} sub=${e.substituted ?? false} ${String(e.comment ?? "").slice(0, 24)}`); },
});
const record = await p;
const realMoves = events.filter((e) => e.t === "move" && !e.substituted);
console.log(`[T5] 对局结束：真实 LLM 着法 ${realMoves.length}/${events.filter((e) => e.t === "move").length}，summary=${record.summary}`);
gw.close();
process.exit(0);
