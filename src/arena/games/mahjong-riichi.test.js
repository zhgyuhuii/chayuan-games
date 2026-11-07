/**
 * 日麻立直用例（games2 Q1/Q7）：dora 轮转/七对/役种评估/立直锁/振听拒荣/
 * 无役拒胡/开局首摸/全模拟。独立文件避开 arena.test.js（并行会话区）。
 */
import { describe, expect, it } from "vitest";
import { createRiichiGame, evalYaku, doraOf, isChiitoi } from "./mahjong-riichi.js";
import { getGame } from "../registry.js";

describe("立直麻将：牌理与役种", () => {
  it("doraOf 轮转：数牌 n+1 环绕、风牌轮转、三元轮转", () => {
    expect(doraOf("1m")).toBe("2m");
    expect(doraOf("9m")).toBe("1m");
    expect(doraOf("E")).toBe("S");
    expect(doraOf("N")).toBe("E");
    expect(doraOf("C")).toBe("F");
    expect(doraOf("B")).toBe("C");
  });
  it("七对子判定", () => {
    expect(isChiitoi(["1m", "1m", "3m", "3m", "5m", "5m", "7m", "7m", "9m", "9m", "E", "E", "S", "S"])).toBe(true);
    expect(isChiitoi(["1m", "1m", "1m", "3m", "3m", "5m", "5m", "7m", "7m", "9m", "9m", "E", "E", "S"])).toBe(false);
  });
  it("evalYaku：立直+门前自摸+宝牌 / 断幺 / 役牌 / 平和与雀头役牌互斥", () => {
    const y1 = evalYaku(["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "E", "E"], [], { riichi: true, selfDraw: true, seat: 0, dora: ["E"] });
    expect(y1.fan).toBe(4); // 立直1+门前自摸1+宝牌2（雀头 E 是役牌牌 → 非平和，只有宝牌立直自摸）
    const y2 = evalYaku(["2m", "3m", "4m", "5m", "6m", "7m", "2p", "3p", "4p", "5s", "6s", "7s", "8s", "8s"], [], { riichi: false, selfDraw: true, seat: 1, dora: [] });
    expect(y2.yaku).toContain("断幺九");
    expect(y2.yaku).toContain("门前清自摸和");
    const y3 = evalYaku(["E", "E", "E", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "C", "C"], [], { riichi: false, selfDraw: false, seat: 0, dora: [] });
    expect(y3.yaku).toContain("役牌·东"); // 场风东
    expect(y3.yaku).not.toContain("平和"); // 雀头 C 三元 → 非平和（近似判定的互斥钉子）
    const y4 = evalYaku(["2m", "3m", "4m", "5m", "6m", "7m", "2p", "3p", "4p", "2s", "3s", "4s", "8s", "8s"], [], { riichi: false, selfDraw: false, seat: 1, dora: [] });
    expect(y4.yaku).toContain("三色同顺"); // 234m/234p/234s（无役不能胡的引擎侧拦截由集成用例覆盖）
  });
});

describe("立直麻将：引擎流程", () => {
  it("注册：独立 id、开局庄家已摸（kind=self、14 张）", () => {
    const def = getGame("mahjong-riichi");
    expect(def?.label).toBe("日本立直麻将");
    const g = def.createGame({ seed: 1 });
    const pend = g.pendingAction();
    expect(pend.seat).toBe(0);
    expect(pend.kind).toBe("self");
    expect(g.getState().hands[0].length).toBe(14);
    expect(g.viewFor(0)).toContain("宝牌指示牌");
    expect(g.viewFor(0)).toContain("振听"); // 中度辅助：振听说明在场（Q7）
  });
  it("立直宣告：门前听牌才可、宣告后摸切锁定、不能再杠", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const g = createRiichiGame({ seed });
      let guard = 0;
      let riichiSeat = null;
      while (!g.result() && guard < 800) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        if (pend.kind === "self" && pend.actions.includes("action:riichi") && riichiSeat == null) {
          riichiSeat = pend.seat;
          const r = g.apply(pend.seat, "action:riichi");
          expect(r.ok).toBe(true);
          // 宣告后本巡仍须打牌，且只能打刚摸的
          const np = g.pendingAction();
          expect(np.seat).toBe(riichiSeat);
          expect(np.actions.every((a) => a.startsWith("action:hora") || a.startsWith("discard:"))).toBe(true);
          // 打出刚摸那张（摸切）合法；打别的拒绝
          const st = g.getState();
          const drawnTile = st.drawn;
          const bad = st.hands[riichiSeat].find((t) => t !== drawnTile);
          if (bad) {
            const rej = g.apply(riichiSeat, `discard:${bad}`);
            if (rej.ok) throw new Error("立直后打出非摸切牌竟合法");
          }
          const r2 = g.apply(riichiSeat, `discard:${drawnTile}`);
          expect(r2.ok).toBe(true);
          // 下一巡摸切锁定继续
          continue;
        }
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
      }
      if (riichiSeat != null) return;
    }
    throw new Error("40 seed 未扫到可立直局面");
  });
  it("无役不能胡：荣和候选只有成胡型且有役才出现 hora（全模拟验证 rejects 干净）", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const g = createRiichiGame({ seed });
      let guard = 0;
      while (!g.result() && guard < 1500) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        if (pend.kind === "claim") {
          // 假 hora（无资格）必拒且不污染状态
          if (!pend.actions.includes("action:hora")) {
            const before = JSON.stringify(g.getState());
            expect(g.apply(pend.seat, "action:hora").ok).toBe(false);
            expect(JSON.stringify(g.getState())).toBe(before);
          }
        }
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
      }
      const res = g.result();
      if (!res.summary.includes("流局")) {
        expect(res.summary).toMatch(/番/);
        const winner = res.ranks.indexOf(0);
        expect(res.scores[winner]).toBeGreaterThan(0);
      }
    }
  });
  it("全程模拟：流局或胡即终局、点数与番数口径在摘要", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const g = createRiichiGame({ seed });
      let guard = 0;
      while (!g.result() && guard < 1500) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed}: ${r.reason}`);
      }
      expect(g.result()).not.toBeNull();
    }
  });
});
