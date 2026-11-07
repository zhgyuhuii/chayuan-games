/**
 * __skip__ 放行哨兵回归（2026-11-07 人机局「AI 接手 ↔ 人工接管」）：
 * 接手首步在途（humanPlayer resolver 挂起、runner await 中）时切回人工——
 * 旧 hp.submit("__skip__") 必须：不落子、runner 不死、下一轮重取到换回后的
 * 新 HumanPlayer。用围棋（有 pass）跑通完整对局收口。
 */
import { describe, expect, it } from "vitest";
import { createGoGame } from "../src/arena/games/go.js";
import { createHumanPlayer } from "../src/arena/players.js";
import { runMatch } from "../src/arena/match-runner.js";
import { getGame } from "../src/arena/registry.js";

describe("MatchRunner __skip__ 放行哨兵", () => {
  it("切回人工：__skip__ 不落子，下一手由新 HumanPlayer 出，对局正常收口", async () => {
    const gameDef = getGame("go9");
    const game = gameDef.createGame({ seed: 1 });
    const hpOld = createHumanPlayer({ name: "我" });
    const hpNew = createHumanPlayer({ name: "我" });
    const aiPass = { kind: "llm", name: "B", act: async () => ({ move: "pass", comment: "" }) };
    const players = [hpOld, aiPass];
    const events = [];
    const p = runMatch({
      game, gameDef, players,
      playerMeta: [
        { seat: 0, id: "human:me", label: "我", kind: "human", cloud: false },
        { seat: 1, id: "m/b", label: "B", kind: "llm", cloud: true },
      ],
      mode: "human_vs_ai", think: false, maxSteps: 40,
      onEvent: (e) => events.push(e),
    });
    // runner 挂起在 hpOld.act（seat0 人类回合）
    await new Promise((r) => setTimeout(r, 20));
    expect(hpOld.pendingResolver).toBeTruthy();
    // 模拟 AI 接手：players[0] 换接手模型、首步在途（不 submit）——runner 仍 await hpOld
    const takeoverLlm = { kind: "llm", name: "T", act: async () => ({ move: "E5", comment: "" }) };
    players[0] = takeoverLlm;
    // 模拟人工接管（takebackHuman 同序：先换引用后放行）
    players[0] = hpNew;
    hpOld.submit("__skip__", "");
    // 下一手（仍 seat0）由 hpNew 出：人类落子
    await new Promise((r) => setTimeout(r, 20));
    expect(hpNew.pendingResolver).toBeTruthy(); // runner 已重取到新 HumanPlayer
    hpNew.submit("E5", "");
    // seat1 AI pass → seat0 再 pass → 双 pass 终局
    await new Promise((r) => setTimeout(r, 20));
    if (hpNew.pendingResolver) hpNew.submit("pass", "");
    const record = await p;
    const moves = events.filter((e) => e.t === "move").map((e) => `${e.seat}:${e.move}`);
    expect(moves).toContain("0:E5"); // 人类接管后落子
    expect(moves.filter((m) => m.startsWith("0:") && m !== "0:pass").length).toBe(1); // __skip__ 未产生落子（pass 是双 pass 终局的合法虚着）
    expect(record.ranks.length).toBe(2); // 对局正常收口（双 pass 数子终局）
    expect(events.some((e) => e.t === "end")).toBe(true);
  });
});
