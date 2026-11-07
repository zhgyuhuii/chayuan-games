/**
 * 网关 /v1/models 双口径单测（mock 厂商 + startGateway 直启）：
 *  - GET（测试连接口径）：可达报 vendor/ 前缀实拉列表；不可达静默回退手填 models
 *  - POST（获取模型口径）：未保存 baseUrl/key 覆盖已存配置，严格实拉不回退，
 *    失败原样透传，成功返回裸模型 id（string/{id} 元素均容错）
 */
import { createServer } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { startGateway } from "../electron/gateway.js";

const GOOD_KEY = "sk-good";

// mock 厂商：/models 校验 Bearer key；列表混入裸 string 元素（容错口径）
const vendor = createServer((req, res) => {
  if (req.url !== "/models") {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end("{}");
  }
  if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "invalid api key" } }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: "mock-alpha" }, { id: "mock-beta" }, "mock-gamma"] }));
});
await new Promise((r) => vendor.listen(0, "127.0.0.1", r));
const mockBase = `http://127.0.0.1:${vendor.address().port}`;
const DEAD = "http://127.0.0.1:1"; // 保留端口，连接必拒

// mock Anthropic 协议厂商：校验 x-api-key + anthropic-version（区别于 Bearer）
const anthropicVendor = createServer((req, res) => {
  if (req.headers["x-api-key"] !== GOOD_KEY || req.headers["anthropic-version"] !== "2023-06-01") {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "need x-api-key" } }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: "claude-x" }] }));
});
await new Promise((r) => anthropicVendor.listen(0, "127.0.0.1", r));
const anthropicBase = `http://127.0.0.1:${anthropicVendor.address().port}`;

const config = { vendors: [
  { id: "mockv", key: GOOD_KEY, baseUrl: mockBase, models: ["hand-filled"], enabled: true },
  { id: "stale", key: GOOD_KEY, baseUrl: DEAD, models: ["hand-filled"], enabled: true }, // 已存 baseUrl 已失效——POST 覆盖后应实拉成功
  { id: "unreach", key: "sk-x", baseUrl: DEAD, models: ["fallback-a", "fallback-b"], enabled: true },
] };
const gw = await startGateway({ getConfig: () => config });
afterAll(() => { vendor.close(); anthropicVendor.close(); gw.close(); });

const call = (path, init) =>
  fetch(`${gw.base}/t/${gw.token}${path}`, init).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

describe("gateway /v1/models", () => {
  it("POST 覆盖已存 baseUrl/key：未保存输入实拉成功，返回裸 id（含 string 元素容错）", async () => {
    const r = await call("/v1/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor: "stale", baseUrl: mockBase, key: GOOD_KEY }) });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(["mock-alpha", "mock-beta", "mock-gamma"]);
  });

  it("POST 无覆盖：回退已存厂商配置（保存后直接点获取也可用）", async () => {
    const r = await call("/v1/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor: "mockv" }) });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(["mock-alpha", "mock-beta", "mock-gamma"]);
  });

  it("POST 错误 key：厂商 401 原样透传，不回退手填", async () => {
    const r = await call("/v1/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor: "stale", baseUrl: mockBase, key: "sk-bad" }) });
    expect(r.status).toBe(401);
    expect(r.body.error?.message).toBe("invalid api key");
  });

  it("POST api=anthropic-messages：x-api-key + anthropic-version 头实拉（自定义 Anthropic 厂商）", async () => {
    const r = await call("/v1/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor: "ghost", baseUrl: anthropicBase, key: GOOD_KEY, api: "anthropic-messages" }) });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(["claude-x"]);
  });

  it("POST 未声明 api：默认 Bearer 头（anthropic mock 拒绝，证明默认口径不串）", async () => {
    const r = await call("/v1/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor: "ghost", baseUrl: anthropicBase, key: GOOD_KEY }) });
    expect(r.status).toBe(401);
    expect(r.body.error?.message).toBe("need x-api-key");
  });

  it("POST 未知厂商且无 baseUrl：400", async () => {
    const r = await call("/v1/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vendor: "ghost" }) });
    expect(r.status).toBe(400);
  });

  it("无 token：401", async () => {
    const r = await fetch(`${gw.base}/v1/models`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });

  it("GET 回归：厂商可达报 vendor/ 前缀实拉列表", async () => {
    const r = await call("/v1/models?vendor=mockv");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([
      { id: "mockv/mock-alpha", vendor: "mockv" },
      { id: "mockv/mock-beta", vendor: "mockv" },
      { id: "mockv/mock-gamma", vendor: "mockv" },
    ]);
  });

  it("GET 回归：厂商不可达静默回退手填 models", async () => {
    const r = await call("/v1/models?vendor=unreach");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([
      { id: "unreach/fallback-a", vendor: "unreach" },
      { id: "unreach/fallback-b", vendor: "unreach" },
    ]);
  });
});
