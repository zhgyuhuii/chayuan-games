/**
 * LlmPlayer 503/429/网络错处理精度（2026-11-06 agnes 503 / nvidia 429 实锤）：
 *  - 厂商上游 503（非 engine_busy）：立即失败带上游原文，不进 3.5s 自愈等待；
 *  - engine_busy 503：保持 3 次自愈重试；期间恢复（第二次 200）照常出招；
 *  - 厂商 429 限流：信 retry-after（缺席 3.5s→7s 递增）退避后在调用内重试，
 *    不烧 MatchRunner 重试额度；持续限流 3 次后带原文失败；
 *  - 网络错（fetch failed）：小退避（1s→2s）后再试，恢复即出招。
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { createLlmPlayer } from "../src/arena/players.js";
import { __resetProtocolProfiles } from "../src/arena/protocol-profile.js";

const okMove = (move = "H8") => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: `{"move":"${move}","comment":"好棋"}` } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }),
});

describe("LlmPlayer 503 处理", () => {
  const originalFetch = globalThis.fetch;
  // 协议画像是模块级缓存（跨测试共享）：逐测试隔离，防 strong/broken 判定串味
  beforeEach(() => { __resetProtocolProfiles(); });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    __resetProtocolProfiles();
  });

  it("厂商上游 503：单次即败、错误带上游原文", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => '{"ok":false,"error":{"message":"vendor agnes 503: upstream overloaded"}}',
    }));
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "agnes/agnes-2.5-flash", proxyBase: "http://127.0.0.1:52581" });
    await expect(p.act("system", "view", "", null)).rejects.toThrow(/vendor agnes 503/);
    expect(fetchMock, "非 engine_busy 不得自愈重试").toHaveBeenCalledTimes(1);
  });

  it("engine_busy 503：第二次恢复照常出招", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 503, text: async () => '{"error":{"code":"engine_busy","message":"busy"}}' };
      return okMove();
    });
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "local/qwen3.5-4b-q4km", proxyBase: "http://127.0.0.1:52581" });
    const outcome = p.act("system", "view", "", null);
    await vi.advanceTimersByTimeAsync(4_000); // 越过首个 3.5s 自愈等待
    await expect(outcome).resolves.toMatchObject({ move: "H8" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("engine_busy 503 持续：3 次后失败", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => '{"error":{"code":"engine_busy"}}',
    }));
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "local/x", proxyBase: "http://127.0.0.1:52581" });
    const outcome = p.act("system", "view", "", null);
    const assertion = expect(outcome).rejects.toThrow(/HTTP 503/);
    await vi.advanceTimersByTimeAsync(10_000); // 两个 3.5s 等待全部烧完
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("推理型模型（deepseek-reasoner）：content 空回退 reasoning_content，max_tokens 给足", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "", reasoning_content: '想好了 {"move":"H8","comment":"天元"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    }));
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "deepseek/deepseek-reasoner", proxyBase: "http://127.0.0.1:52581" });
    await expect(p.act("system", "view", "", null)).resolves.toMatchObject({ move: "H8" });
    // max_tokens 1200：400 会被思维链烧穿 → content 空 =「输出无法解析」实锤
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1200);
  });

  it("厂商 429 限流：信 retry-after 退避，恢复后照常出招（2026-11-06 nvidia 429 实锤）", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      if (n <= 2) return { ok: false, status: 429, headers: { get: (k) => (k === "retry-after" ? "2" : null) }, text: async () => '{"status":429,"title":"Too Many Requests"}' };
      return okMove();
    });
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "nvidia/z-ai/glm-5.3-flash", proxyBase: "http://127.0.0.1:52581" });
    const outcome = p.act("system", "view", "", null);
    await vi.advanceTimersByTimeAsync(2_100); // 第一个 retry-after 2s
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_100); // 第二个 retry-after 2s
    await expect(outcome).resolves.toMatchObject({ move: "H8" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("厂商 429 持续：3 次退避后带原文失败", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => '{"status":429,"title":"Too Many Requests"}',
    }));
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "nvidia/z-ai/glm-5.3-flash", proxyBase: "http://127.0.0.1:52581" });
    const outcome = p.act("system", "view", "", null);
    const assertion = expect(outcome).rejects.toThrow(/HTTP 429/);
    await vi.advanceTimersByTimeAsync(15_000); // 3.5s + 7s 退避全部烧完
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("网络错（fetch failed）：小退避后恢复照常出招", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      if (n <= 2) throw new TypeError("fetch failed");
      return okMove();
    });
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "nvidia/z-ai/glm-5.3-flash", proxyBase: "http://127.0.0.1:52581" });
    const outcome = p.act("system", "view", "", null);
    await vi.advanceTimersByTimeAsync(1_100); // 第一次退避 1s
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_100); // 第二次退避 2s
    await expect(outcome).resolves.toMatchObject({ move: "H8" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("续写补全（2026-11-06 象棋 rambling 玩家 B 实锤）：一次无 JSON 后后续请求预填 assistant 头", async () => {
    let n = 0;
    const fetchMock = vi.fn(async (_url, init) => {
      n += 1;
      const body = JSON.parse(init.body);
      if (n === 1) {
        expect(body.messages).toHaveLength(2); // 无预填
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "我们需要回答只输出一个 JSON 对象…让我理解" } }], usage: {} }) };
      }
      // 第二次：已进续写模式——messages 尾部带 assistant 预填头
      expect(body.messages).toHaveLength(3);
      expect(body.messages[2]).toEqual({ role: "assistant", content: '{"move":"' });
      // 上游只回接续段（无左花括号）
      // 上游只回「值的接续段」：预填头 {"move":" 之后的 h3e3","comment":"…"}
      // （真实 assistant 续写不含键名，更无左花括号）
      const continuation = 'h3e3","comment":"平炮思路' + '"}';
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: continuation } }], usage: {} }) };
    });
    globalThis.fetch = fetchMock;
    const p = createLlmPlayer({ modelRef: "free/gateway", proxyBase: "http://127.0.0.1:52581" });
    await expect(p.act("system", "view", "", null)).rejects.toThrow(/无法解析/);
    await expect(p.act("system", "view", "", null)).resolves.toMatchObject({ move: "h3e3", comment: "平炮思路" });
  });

  it("续写补全被网关拒（400）：立即回退普通提问，不烧重试额度", async () => {
    const p = createLlmPlayer({ modelRef: "free/gateway", proxyBase: "http://127.0.0.1:52581" });
    // 预触发 primeMode：第一次 act 走普通两消息路径，喂无 JSON 输出
    let phase = 0;
    globalThis.fetch = vi.fn(async () => {
      if (phase === 0) {
        phase = 1;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "rambling no json" } }], usage: {} }) };
      }
      return okMove();
    });
    await expect(p.act("system", "view", "", null)).rejects.toThrow(/无法解析/);
    // primeMode 已开：预填 400 → 回退普通提问 → 200，同一次 act 内完成
    let sawPrimed = false;
    globalThis.fetch = vi.fn(async (_u, init) => {
      const body = JSON.parse(init.body);
      if (body.messages.length === 3) {
        sawPrimed = true;
        return { ok: false, status: 400, text: async () => "no assistant-last" };
      }
      return okMove();
    });
    await expect(p.act("system", "view", "", null)).resolves.toMatchObject({ move: "H8" });
    expect(sawPrimed).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("assistant 预填不被支持（200+空 content，2026-11-06 玩家B 实锤）：瞬态重试→只禁 assistant，落到行内续写", async () => {
    const p = createLlmPlayer({ modelRef: "free/gateway", proxyBase: "http://127.0.0.1:52581" });
    // 触发 primeMode：第一次无 JSON
    let phase = 0;
    globalThis.fetch = vi.fn(async () => {
      if (phase === 0) {
        phase = 1;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "rambling no json" } }], usage: {} }) };
      }
      return okMove();
    });
    await expect(p.act("system", "view", "", null)).rejects.toThrow(/无法解析/);
    // 第二次 act：assistant 空回（1）→ 瞬态重试再空（2）→ 只禁 assistant，行内续写成功（3）
    const shapes = [];
    globalThis.fetch = vi.fn(async (_u, init) => {
      const body = JSON.parse(init.body);
      shapes.push(body.messages.length);
      if (body.messages.length === 3) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }], usage: {} }) };
      // 行内续写（2 消息）：模型真接续 → 拼回解析
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '"H8","comment":"good" }' } }], usage: {} }) };
    });
    await expect(p.act("system", "view", "", null)).resolves.toMatchObject({ move: "H8", comment: "good" });
    expect(shapes).toEqual([3, 3, 2]);
    // 第三次 act：primeBroken 但行内仍活（不连坐）——直接走行内续写
    globalThis.fetch = vi.fn(async (_u, init) => {
      const body = JSON.parse(init.body);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[1].content).toContain("最高优先级·输出协议");
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"move":"b3b10","comment":"eat"}' } }], usage: {} }) };
    });
    await expect(p.act("system", "view", "", null)).resolves.toMatchObject({ move: "b3b10", comment: "eat" });
  });

  it("行内续写两种回答形态都能解析（2026-11-06 英文鹦鹉模型实锤）", async () => {
    const p = createLlmPlayer({ modelRef: "free/gateway", proxyBase: "http://127.0.0.1:52581" });
    // 触发 primeMode（第一次无 JSON）
    let phase = 0;
    globalThis.fetch = vi.fn(async () => {
      if (phase === 0) { phase = 1; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "rambling" } }], usage: {} }) }; }
      return okMove();
    });
    await expect(p.act("system", "view", "", null)).rejects.toThrow(/无法解析/);
    // act2：先试 assistant 预填（空回 → 只禁 assistant）→ 落行内续写（2 消息 +
    // 严令尾注正文停在 {"move":"）→ 模型真接续 → 拼回解析
    globalThis.fetch = vi.fn(async (_u, init) => {
      const body = JSON.parse(init.body);
      if (body.messages.length === 3) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }], usage: {} }) };
      expect(body.messages).toHaveLength(2);
      expect(body.messages[1].content).toContain("OUTPUT PROTOCOL");
      expect(body.messages[1].content.trimEnd().endsWith('{"move":"')).toBe(true);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '"h3e3","comment":"ping" }' } }], usage: {} }) };
    });
    await expect(p.act("system", "view", "", null)).resolves.toMatchObject({ move: "h3e3", comment: "ping" });
    // act3：行内续写 → 指令式模型回全量 JSON（以 { 开头）→ 原样解析，不重复拼头
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"move":"b3b10","comment":"eat"}' } }], usage: {} }) }));
    await expect(p.act("system", "view", "", null)).resolves.toMatchObject({ move: "b3b10", comment: "eat" });
  });

  it("伪搜索（deep）：三段协议注入 system；分析+结论+答案全链解析；raw 放宽 800 保推演进思考气泡", async () => {
    const { __resetProtocolProfiles } = await import("../src/arena/protocol-profile.js");
    __resetProtocolProfiles();
    const deepText = "分析：\n我走h3e3 → 对方馬8进7 → 平\n我走b3b10吃馬 → 对方砲8平5反捉 → 劣\n我走车九进一护肋 → 对方卒7进1 → 平\n结论：占中线控局，选炮二平五\n答案：{\"move\":\"h3e3\",\"comment\":\"当头炮控中\"}";
    let sysSeen = "";
    global.fetch = async (_u, init) => {
      const body = JSON.parse(init.body);
      sysSeen = body.messages[0].content;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: deepText } }], usage: { prompt_tokens: 1, completion_tokens: 300 } }) };
    };
    const p = createLlmPlayer({ modelRef: "deep/model", proxyBase: "http://127.0.0.1:52581", deep: true });
    const out = await p.act("SYS", "view", "", null);
    expect(sysSeen).toContain("变着推演");
    expect(sysSeen).toContain("3 条候选着法线");
    expect(out.move).toBe("h3e3");
    expect(out.comment).toBe("当头炮控中");
    expect(out.raw).toContain("结论");
    expect(out.raw.length).toBeLessThanOrEqual(800);
    __resetProtocolProfiles();
  });

  it("parseMoveOutput：续写头被整体复读（{\"move\":\"{\"move\":…）不误配嵌套头", async () => {
    const { parseMoveOutput } = await import("../src/arena/players.js");
    expect(parseMoveOutput('{"move":"{"move":"h8","comment":"x"}')).toEqual({ move: "h8", comment: "x" });
  });
});
