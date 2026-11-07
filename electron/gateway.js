/**
 * 主进程模型网关（摘 chatop-models 精华，chayuan-game 版）：
 *  - 127.0.0.1 随机端口 + token 鉴权（query ?t= 或 Authorization，query 形式
 *    保证 renderer 引擎层 players.js 的 fetch URL 原样可用——同构面零改动）
 *  - POST /v1/chat/completions：按 modelRef "<vendor>/<model>" 路由到厂商
 *    baseUrl + key；OpenAI 兼容直通；anthropic-messages 厂商做协议转换
 *  - GET /v1/models?vendor=xx：测试连接/模型发现（手填口径的连通性验证）
 *  - CORS 全放（本机自用网关，token 即凭证）
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const ANTHROPIC_VENDORS = new Set(["anthropic", "aws-bedrock"]); // anthropic-messages 协议厂商

export function startGateway({ getConfig }) {
  const token = randomBytes(16).toString("hex");

  /** modelRef → { baseUrl, key, api, model }；找不到返回 null。 */
  function route(modelRef) {
    const cfg = getConfig();
    const idx = String(modelRef ?? "").indexOf("/");
    if (idx <= 0) return null;
    const vendorId = modelRef.slice(0, idx);
    const model = modelRef.slice(idx + 1);
    const vendor = (cfg.vendors ?? []).find((v) => v.id === vendorId && v.enabled !== false);
    if (!vendor?.baseUrl || !vendor.key) return null;
    return { baseUrl: vendor.baseUrl.replace(/\/$/, ""), key: vendor.key, api: vendor.api ?? "openai-completions", model };
  }

  /** anthropic-messages → OpenAI chat 请求体转换（摘 convert 精华：messages+system+max_tokens+temperature）。 */
  function toAnthropicBody(openaiBody, model) {
    const sys = (openaiBody.messages ?? []).filter((m) => m.role === "system").map((m) => m.content).join("\n");
    return {
      model,
      max_tokens: openaiBody.max_tokens ?? 1200,
      temperature: openaiBody.temperature,
      ...(sys ? { system: sys } : {}),
      messages: (openaiBody.messages ?? []).filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    };
  }
  /** Anthropic 响应 → OpenAI chat 响应（content blocks 拼接 + usage 映射）。 */
  function fromAnthropicResponse(data) {
    const text = (data.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
    return {
      id: data.id, object: "chat.completion", model: data.model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: data.stop_reason === "max_tokens" ? "length" : "stop" }],
      usage: { prompt_tokens: data.usage?.input_tokens ?? 0, completion_tokens: data.usage?.output_tokens ?? 0, total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) },
    };
  }

  function json(res, code, body) {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Content-Length": buf.length,
    });
    res.end(buf);
  }

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
  }

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }); return res.end(); }
    // token 走路径段 /t/<token>/…（2026-11-07 真机 T4 实锤：query 形式 base?t=token
    // 会被 players.js 的 `${base}/v1/…` 拼接吃掉路径 → 永远 401；路径段拼接天然
    // 正确且校验精确。兼容 Authorization Bearer（非引擎调用方）。
    const url = new URL(req.url, "http://127.0.0.1");
    const mToken = /^\/t\/([0-9a-f]{32})(\/.*)$/.exec(url.pathname);
    const okToken = (mToken && mToken[1] === token) || req.headers.authorization === `Bearer ${token}`;
    if (!okToken) return json(res, 401, { error: { message: "invalid gateway token" } });
    if (mToken) url.pathname = mToken[2]; // 剥 token 段后再路由

    if (req.method === "GET" && url.pathname === "/v1/models") { // (url 已剥 token 段)
      const vendorId = url.searchParams.get("vendor");
      const cfg = getConfig();
      const vendors = (cfg.vendors ?? []).filter((v) => (vendorId ? v.id === vendorId : true) && v.enabled !== false);
      const out = [];
      for (const v of vendors) {
        if (!v.baseUrl) { out.push(...(v.models ?? []).map((m) => ({ id: `${v.id}/${m}`, vendor: v.id }))); continue; } // 无 baseUrl 手填档：直接报已配置模型
        try {
          const r = await fetch(`${v.baseUrl.replace(/\/$/, "")}/models`, { headers: v.api === "anthropic-messages" ? { "x-api-key": v.key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${v.key}` }, signal: AbortSignal.timeout(8000) });
          if (r.ok) {
            const data = await r.json();
            out.push(...(data.data ?? []).map((m) => ({ id: `${v.id}/${m.id}`, vendor: v.id })));
          } else out.push(...(v.models ?? []).map((m) => ({ id: `${v.id}/${m}`, vendor: v.id })));
        } catch { out.push(...(v.models ?? []).map((m) => ({ id: `${v.id}/${m}`, vendor: v.id }))); }
      }
      return json(res, 200, { object: "list", data: out });
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readBody(req);
      const route_ = route(body.model);
      if (!route_) return json(res, 404, { error: { message: `未配置的模型命名空间：${body.model}（设置 → 模型配置 填 key/baseUrl）` } });
      try {
        if (route_.api === "anthropic-messages" || ANTHROPIC_VENDORS.has(body.model.split("/")[0])) {
          const r = await fetch(`${route_.baseUrl}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": route_.key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify(toAnthropicBody(body, route_.model)),
            signal: AbortSignal.timeout(300_000),
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) return json(res, r.status, { error: { message: data?.error?.message ?? `厂商 ${r.status}` } });
          return json(res, 200, fromAnthropicResponse(data));
        }
        // OpenAI 兼容直通（model 换成 vendor 内段；透传 temperature/max_tokens/messages/stop）
        const r = await fetch(`${route_.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${route_.key}` },
          body: JSON.stringify({ ...body, model: route_.model }),
          signal: AbortSignal.timeout(300_000),
        });
        const data = await r.json().catch(() => null);
        if (data === null) return json(res, r.status, { error: { message: `厂商返回 HTTP ${r.status}（非 JSON 响应）` } }); // 错误信息不吞
        return json(res, r.status, data);
      } catch (e) {
        return json(res, 502, { error: { message: `网关转发失败：${e?.message ?? e}` } });
      }
    }

    json(res, 404, { error: { message: `no route: ${req.method} ${url.pathname}` } });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, token, base: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
