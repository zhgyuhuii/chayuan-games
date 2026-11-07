/**
 * 血流成湖用例（games2 Q5 最小血流）：胡家不清场/多次胡/墙干或四家全胡终局/
 * 查叫只查未胡家/battle 回归零变化。独立文件避开 arena.test.js（并行会话区）。
 */
import { describe, expect, it } from "vitest";
import { createMahjongGame } from "./mahjong.js";
import { getGame } from "../registry.js";

/** 代走驱动到终局（suggestAction 全程；与 arena.test.js 血战用例同法）。 */
function playToEnd(seed, variant = "flow") {
  const g = createMahjongGame({ seed, variant });
  let guard = 0;
  while (!g.result() && guard < 1200) {
    guard += 1;
    const pend = g.pendingAction();
    if (!pend) break;
    const r = g.apply(pend.seat, g.suggestAction(pend.seat));
    if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
  }
  return { g, steps: guard };
}

describe("血流成湖（mahjong-xueliu）", () => {
  it("注册：独立 id、共享引擎、走 flow 变体", () => {
    const def = getGame("mahjong-xueliu");
    expect(def?.label).toBe("四川血流成湖");
    expect(def.seats).toBe(4);
    expect(def.createGame({ seed: 1 }).viewFor(0)).toContain("血流成湖");
  });

  it("胡家不清场：首次胡后游戏继续、胡家 alive 且 won 标记、轮到他打一张", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const g = createMahjongGame({ seed, variant: "flow" });
      let guard = 0;
      let firstHora = null;
      while (!g.result() && guard < 1200) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
        const horaEv = (r.events ?? []).find((e) => e.t === "hora");
        if (horaEv && !firstHora) {
          firstHora = horaEv;
          break; // 首胡瞬间停下检查
        }
      }
      if (!firstHora) continue; // 该 seed 代走没打出胡（概率事件），下一个
      const st = g.getState();
      expect(st.alive[firstHora.seat]).toBe(true); // 不离场
      expect(st.won[firstHora.seat]).toBe(true);
      expect(g.result()).toBeNull(); // 首胡≠终局（flow 只有墙干/四家全胡才终局）
      const pend = g.pendingAction();
      expect(pend.seat).toBe(firstHora.seat); // 胡家打一张继续
      expect(st.hands[firstHora.seat].length % 3).toBe(2); // 3n+2 待打
      return; // 找到一个成立即过
    }
    throw new Error("30 个 seed 内未出现首胡（代走口径异常或运气极端）");
  });

  it("已胡家只能自摸：不进表态候选、自家回合无杠动作", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const g = createMahjongGame({ seed, variant: "flow" });
      let guard = 0;
      let wonSeat = null;
      while (!g.result() && guard < 1200) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
        const horaEv = (r.events ?? []).find((e) => e.t === "hora");
        if (horaEv) { wonSeat = horaEv.seat; break; }
      }
      if (wonSeat == null) continue;
      // 继续打到出现「已胡家非行动者」的局面，验证他不进 claim 候选
      let guard2 = 0;
      let checkedClaim = false;
      let checkedSelf = false;
      while (!g.result() && guard2 < 1200 && !(checkedClaim && checkedSelf)) {
        guard2 += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        if (pend.kind === "claim") {
          checkedClaim = true;
          expect(pend.seat).not.toBe(wonSeat); // 已胡家不表态
        }
        if (pend.seat === wonSeat && pend.kind === "self") {
          checkedSelf = true;
          expect(pend.actions.some((a) => a.startsWith("action:ankan") || a.startsWith("action:kakan"))).toBe(false); // 已胡家无杠
        }
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
      }
      return;
    }
    throw new Error("40 个 seed 内未验证到已胡家约束");
  });

  it("全程模拟到终局：ranks 完整、终局原因合法（墙干或四家全胡）", () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const { g } = playToEnd(seed);
      const res = g.result();
      expect(res).not.toBeNull();
      expect(res.ranks.length).toBe(4);
      expect(res.summary).toMatch(/牌墙摸干|四家全胡/);
    }
  });

  it("查叫只查未胡家：胡过的不赔（终局摘要可含查叫且 won 家不在未听列）", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { g } = playToEnd(seed);
      const res = g.result();
      const st = g.getState();
      const notenSeats = [...res.summary.matchAll(/(\d+)号（?花猪）?/g)].map((m) => Number(m[1]) - 1);
      // 摘要里出现的未听/花猪号位必须是未胡家
      for (const s of notenSeats) expect(st.won[s]).toBe(false);
    }
  });

  it("battle 回归零变化：默认 variant 血战离场语义不变", () => {
    const { g } = playToEnd(1, "battle");
    const res = g.result();
    expect(res.summary).toMatch(/血战结束|流局/);
    const st = g.getState();
    expect(st.won.every((w) => !w)).toBe(true); // battle 不用 won 标记
    // 血战终局至少一家离场（胡过）
    expect(st.alive.some((a) => !a) || res.summary.includes("流局")).toBe(true);
  });
});
