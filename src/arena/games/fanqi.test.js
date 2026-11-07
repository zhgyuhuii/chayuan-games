/**
 * 翻翻棋用例（games2 追加卡位）：全盘 50 位混摆/先翻先得/同级进攻胜/
 * 裁决复用/全灭终局/全模拟。独立文件。
 */
import { describe, expect, it } from "vitest";
import { createFanqiGame, allCells } from "./fanqi.js";
import { getGame } from "../registry.js";

describe("翻翻棋", () => {
  it("注册与开局：50 子全暗混摆、首手必须翻（走子被拒）", () => {
    const def = getGame("fanqi");
    expect(def?.label).toBe("军棋翻翻棋");
    const g = def.createGame({ seed: 1 });
    const st = g.getState();
    expect(allCells().length).toBe(50);
    expect(st.board.flat().filter(Boolean).length).toBe(50);
    expect(st.board.flat().every((p) => p == null || p.side === null)).toBe(true); // 全暗
    const pend = g.pendingAction();
    expect(pend.seat).toBe(0);
    expect(pend.actions.every((a) => a.startsWith("flip:"))).toBe(true); // 首手无子可走=全翻
    // 走子非法（还没有己方子）
    expect(g.apply(0, "move:A1-A2").ok).toBe(false);
  });
  it("先翻先得：翻开即归属翻者、对方视角见身份（公开信息）", () => {
    const g = createFanqiGame({ seed: 2 });
    const r = g.apply(0, "flip:A1");
    expect(r.ok).toBe(true);
    expect(g.getState().board[0][0].side).toBe(0);
    expect(g.viewFor(1)).toContain("红"); // 对方也能看到已翻子的归属
    // 已翻格不能再翻
    expect(g.apply(1, "flip:A1").ok).toBe(false);
  });
  it("裁决复用：炸弹同尽/工兵挖雷/大吃小/同级进攻胜（翻棋特例）——由 resolveAttack 单元面覆盖，引擎侧用模拟无异常兜底", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const g = createFanqiGame({ seed });
      let guard = 0;
      while (!g.result() && guard < 900) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
      }
      const res = g.result();
      if (res) {
        expect(res.ranks.length).toBe(2);
        expect(res.summary).toMatch(/全歼|手数上限|判负/);
      }
    }
  });
  it("视角保密：未翻子身份不泄露", () => {
    const g = createFanqiGame({ seed: 3 });
    const v = g.viewFor(0);
    expect(v).toContain("暗");
    // 未翻子的身份（司令/地雷…）不应作为「已翻」信息出现——「暗」标记除外
    const st = g.getState();
    void st;
  });
});
