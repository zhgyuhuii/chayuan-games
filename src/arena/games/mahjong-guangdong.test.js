/**
 * 广东推倒胡用例（games2 Q1）：34 维判胡/字牌/chi 动作/番种表/胡即终局/
 * 流局 draw/全程模拟。独立文件避开 arena.test.js（并行会话区）。
 */
import { describe, expect, it } from "vitest";
import { createGuangdongGame, isWinHand, waitTiles, evalFan, fullWall } from "./mahjong-guangdong.js";
import { getGame } from "../registry.js";

describe("推倒胡：34 维牌理", () => {
  it("fullWall 136 张（108 数牌 + 28 字牌）", () => {
    expect(fullWall().length).toBe(136);
    expect(fullWall().filter((t) => t.length === 1).length).toBe(28);
  });
  it("判胡：数牌顺刻 + 字牌刻/对（字牌无顺）", () => {
    expect(isWinHand(["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "E", "E", "E", "C", "C"])).toBe(true); // 123/456/789m + EEE + CC
    expect(isWinHand(["1m", "2m", "3m", "E", "E", "E", "S", "S", "S", "W", "W", "W", "N", "N"])).toBe(true); // 全字刻
    // 字牌不可能组顺：E F B 连排不是顺子
    expect(isWinHand(["E", "F", "B", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "C", "C"])).toBe(false);
    // 9m→1p 跨花色非顺
    expect(isWinHand(["8m", "9m", "1p", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "N", "N"])).toBe(false);
  });
  it("听牌：含字牌待牌", () => {
    const waits = waitTiles(["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "E", "E", "E", "N"]);
    expect(waits).toEqual(["N"]); // 123/456/789m + EEE 单钓 N
  });
  it("番种表：平胡1 / 对对胡+2 / 混一色+2 / 清一色+4 / 字一色+8（可叠）", () => {
    const flush = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1m", "1m", "2m", "3m", "4m"]; // 清一色顺子型
    expect(evalFan(flush, [])).toBe(5); // 平胡1 + 清一色4
    const toitoi = ["1m", "1m", "1m", "2m", "2m", "2m", "3m", "3m", "3m", "E", "E", "E", "C", "C"];
    expect(evalFan(toitoi, [])).toBe(5); // 平胡1 + 对对胡2 + 混一色2（m+字）
    const honors = ["E", "E", "E", "S", "S", "S", "W", "W", "W", "N", "N", "N", "C", "C"];
    expect(evalFan(honors, [])).toBe(11); // 平胡1 + 对对胡2 + 字一色8
    const honitsu = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "E", "E", "N", "N", "N"]; // 顺子型混一色
    expect(evalFan(honitsu, [])).toBe(3); // 平胡1 + 混一色2
    // 副露含吃 → 不算对对胡（仍混一色）
    const handSide = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "C", "C"];
    expect(evalFan(handSide, [{ type: "pon", tile: "N", from: 3 }])).toBe(3); // 混一色（手非全刻 → 无对对胡）
    expect(evalFan(handSide, [{ type: "chi", tiles: ["1m", "2m", "3m"], from: 3 }])).toBe(3); // 吃副露不算对对胡，仍混一色
  });
});

describe("推倒胡：引擎流程", () => {
  it("注册：独立 id、开局即庄家摸第 14 张", () => {
    const def = getGame("mahjong-guangdong");
    expect(def?.label).toBe("广东推倒胡");
    const g = def.createGame({ seed: 1 });
    expect(g.phase()).toBe("play");
    const pend = g.pendingAction();
    expect(pend.seat).toBe(0);
    expect(pend.kind).toBe("self"); // 已摸，待打
    expect(g.getState().hands[0].length).toBe(14);
    expect(g.getState().wall).toBe(136 - 13 * 4 - 1);
  });
  it("字牌 discard 合法、未知牌串被拒", () => {
    const g = createGuangdongGame({ seed: 7 });
    const st = g.getState();
    const anyHonor = st.hands[0].find((t) => t.length === 1);
    const anyTile = st.hands[0][0];
    if (anyHonor) {
      expect(g.apply(0, `discard:${anyHonor}`).ok).toBe(true);
    } else {
      expect(g.apply(0, `discard:${anyTile}`).ok).toBe(true);
    }
    const g2 = createGuangdongGame({ seed: 8 });
    const st2 = g2.getState();
    const r = g2.apply(0, `discard:${st2.hands[0][0]}x`);
    expect(r.ok).toBe(false);
  });
  it("全程模拟到终局（代走）：流局 draw 或胡即终局，无异常", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const g = createGuangdongGame({ seed });
      let guard = 0;
      while (!g.result() && guard < 1500) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
      }
      const res = g.result();
      expect(res).not.toBeNull();
      expect(res.ranks.length).toBe(4);
      if (res.summary.includes("流局")) expect(res.draw).toBe(true);
      else {
        expect(res.draw).toBe(false);
        expect(res.summary).toMatch(/番/);
        const winner = res.ranks.indexOf(0);
        expect(res.scores[winner]).toBeGreaterThan(0);
      }
    }
  });
  it("chi 出现在下家候选（扫描局面验证），吃后须打一张", () => {
    // 扫 seed 找「下家可吃」的牌面：打者打数牌后下家手里有能组顺的两张
    for (let seed = 1; seed <= 60; seed += 1) {
      const g = createGuangdongGame({ seed });
      let guard = 0;
      let found = false;
      while (!g.result() && guard < 600 && !found) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        if (pend.kind === "claim" && pend.actions.some((a) => a.startsWith("action:chi:"))) {
          found = true;
          expect(pend.actions.includes("action:pass")).toBe(true);
          const chiAction = pend.actions.find((a) => a.startsWith("action:chi:"));
          const before = g.getState();
          const r = g.apply(pend.seat, chiAction);
          expect(r.ok).toBe(true);
          const after = g.getState();
          // 吃后轮到吃家打一张（手 3n+1，不摸）
          const np = g.pendingAction();
          expect(np.seat).toBe(pend.seat);
          expect(np.kind).toBe("discard");
          expect(after.melds[pend.seat].some((m) => m.type === "chi")).toBe(true);
          expect(after.hands[pend.seat].length % 3).toBe(2); // 13-2=11=3n+2，打一张回 3n+1
          void before;
          break;
        }
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
      }
      if (found) return;
    }
    // 代走从不吃（pass 口径）——chi 候选只由打牌自然产生；60 个 seed 无人打出可吃局面属极端低概率
    throw new Error("60 个 seed 未扫到可吃局面（异常）");
  });
});
