/**
 * 围棋裁判用例（games-llm-arena-games2 Q3/Q4/Q9）：提子/自杀/劫 superko/
 * 双 pass 数子/手数帽/代走启发/形势分。独立文件避开 arena.test.js（并行
 * 会话活跃区）。
 */
import { describe, expect, it } from "vitest";
import { createGoGame, coordOf, parseCoord } from "./go.js";
import { getGame } from "../registry.js";

describe("围棋：注册与坐标", () => {
  it("go9/go13 双 id 注册，共享引擎、动作清单口径正确", () => {
    const a = getGame("go9");
    const b = getGame("go13");
    expect(a?.label).toBe("围棋 9 路");
    expect(b?.label).toBe("围棋 13 路");
    expect(a.createGame({}).pendingAction().actions).toContain("pass");
    expect(a.createGame({}).pendingAction().actions.length).toBe(82); // 81 点 + pass
    expect(b.createGame({}).pendingAction().actions.length).toBe(170); // 169 + pass
  });
  it("coordOf/parseCoord 互逆，A1=左上角（与五子棋同族惯例）", () => {
    expect(coordOf(0, 9)).toBe("A1");
    expect(coordOf(8, 9)).toBe("I1"); // 行 1 最右
    expect(coordOf(72, 9)).toBe("A9"); // 行 9 最左
    expect(coordOf(80, 9)).toBe("I9");
    expect(parseCoord("e5", 9)).toEqual({ i: 40 });
    expect(parseCoord("J1", 9)).toBeNull(); // 越界列
    expect(parseCoord("A10", 9)).toBeNull(); // 越界行
    expect(parseCoord("E5x", 9)).toBeNull();
  });
});

describe("围棋：提子与自杀", () => {
  it("角上围杀：黑 A2 落下即提白 A1，提子计数、A1 空出", () => {
    const g = createGoGame({ size: 9 });
    expect(g.apply(0, "B1").ok).toBe(true);
    expect(g.apply(1, "A1").ok).toBe(true);
    expect(g.apply(0, "A2").ok).toBe(true); // 白 A1 邻 B1(黑)/A2(黑) → 0 气被提
    const st = g.getState();
    expect(st.board[0][0]).toBe(0); // A1 已空
    expect(st.captures[0]).toBe(1); // 黑提 1 子
  });
  it("自杀点非法（无气且未提子），有原因说明", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "B1");
    g.apply(1, "pass");
    g.apply(0, "A2");
    const r = g.apply(1, "A1"); // 白落 A1：邻 B1(黑)/A2(黑) → 自杀
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("自杀");
  });
  it("落子先提对方则己方有气：打吃的反提合法（不算自杀）", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "B1");
    g.apply(1, "A1");
    const r = g.apply(0, "A2"); // 提白后 A2 借 A1 位得气
    expect(r.ok).toBe(true);
    expect(g.getState().captures[0]).toBe(1);
  });
});

describe("围棋：劫与 positional superko（Q3）", () => {
  /** 教科书角劫（9 路左上）：
   *  黑 B1/A2/B3 + E5；白 B2/C1/C3/D2（S8）。
   *  黑 C2 提白 B2 → S9；白 B2 立即回提 = 重现 S8 → positional superko 拒
   *  （比 simple ko 更严：连首次立即回提都禁——Q3 选 superko 正为挡弱模型
   *  无限打劫循环）；白劫材 F6、黑 G6 应后 B2 回提 = S8+F6+G6 ≠ 既往 → 合法。 */
  function setupKo() {
    const g = createGoGame({ size: 9 });
    for (const [seat, mv] of [[0, "B1"], [1, "B2"], [0, "A2"], [1, "C1"], [0, "B3"], [1, "C3"], [0, "E5"], [1, "D2"]]) {
      expect(g.apply(seat, mv).ok).toBe(true);
    }
    return g;
  }
  it("立即回提被拒（positional superko），劫材交换后回提合法", () => {
    const g = setupKo();
    // 黑 C2 提白 B2
    expect(g.apply(0, "C2").ok).toBe(true);
    expect(g.getState().captures[0]).toBe(1);
    // 白 B2 立即回提 = 重现提劫前局面 S8 → superko 拒
    const rej = g.apply(1, "B2");
    expect(rej.ok).toBe(false);
    expect(rej.reason).toContain("全局同形");
    // 白 F6 劫材、黑 G6 应、白 B2 回提 → 局面 = S8+F6+G6，合法
    expect(g.apply(1, "F6").ok).toBe(true);
    expect(g.apply(0, "G6").ok).toBe(true);
    expect(g.apply(1, "B2").ok).toBe(true);
    expect(g.getState().captures[1]).toBe(1);
  });
});

describe("围棋：双 pass 终局与数子（Q3）", () => {
  it("空盘双 pass：白 +7.5 贴目胜 7.5 目", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "pass");
    g.apply(1, "pass");
    const r = g.result();
    expect(r.over).toBe(true);
    expect(r.ranks).toEqual([1, 0]); // 白（seat1）冠军
    expect(r.scores).toEqual([0, 7.5]);
    expect(r.summary).toContain("白胜 7.5");
  });
  it("黑占一角后双 pass：全盘空域归黑，黑 81 子胜", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "A1");
    g.apply(1, "pass");
    g.apply(0, "pass");
    const r = g.result();
    expect(r.ranks).toEqual([0, 1]);
    expect(r.scores[0]).toBe(81); // 1 子 + 80 空域
  });
});

describe("围棋：手数帽（Q9）", () => {
  it("opts.cap 覆盖：到帽强制结算，summary 标注", () => {
    const g = createGoGame({ size: 9, opts: { cap: 4 } });
    g.apply(0, "B2");
    g.apply(1, "C3");
    g.apply(0, "D4");
    g.apply(1, "E5");
    const r = g.result();
    expect(r.over).toBe(true);
    expect(r.summary).toContain("手数上限强制结算");
    expect(g.pendingAction()).toBeNull();
  });
  it("手数帽不误伤双 pass：自然终局优先", () => {
    const g = createGoGame({ size: 9, opts: { cap: 3 } });
    g.apply(0, "B2");
    g.apply(1, "pass");
    g.apply(0, "pass");
    expect(g.result().summary).toContain("双 pass 终局");
  });
});

describe("围棋：代走启发式（Q2 B：能提就提/能救就救）", () => {
  it("对方 1 气群：打其气（提点）", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "B1");
    g.apply(1, "A1"); // 白 A1 只剩 A2 一口气
    expect(g.suggestAction(0)).toBe("A2");
  });
  it("无对方叫吃、己方 1 气群：在气点长气自救", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "B1");
    g.apply(1, "A1");
    g.apply(0, "C5"); // 黑脱先（此时轮白；黑 B1 两气不急）
    expect(g.suggestAction(1)).toBe("A2"); // 白自救长气
  });
  it("无紧急目标 → 合法坐标串", () => {
    const g = createGoGame({ size: 9 });
    expect(g.suggestAction(0)).toMatch(/^[A-I][1-9]$/);
  });
});

describe("围棋：viewFor 与 scoreFor", () => {
  it("viewFor 含棋盘/规则/坐标说明/合法数", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "B2");
    const v = g.viewFor(1);
    expect(v).toContain("围棋 9 路");
    expect(v).toContain("A1=左上角");
    expect(v).toContain("合法落点共");
    expect(v).toContain("最近着法");
  });
  it("scoreFor：黑领先为正、白视角为负、零和、×10 量纲（对齐象棋摆动阈值）", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "B2");
    const s0 = g.scoreFor(0);
    const s1 = g.scoreFor(1);
    expect(s0).toBeGreaterThan(0);
    expect(s0 + s1).toBe(0);
    expect(Math.abs(s0) % 10).toBe(5); // 7.5 贴目 → ×10 后尾数 5
  });
});

describe("围棋：悔棋 undoPlies（2026-11-07 补齐——五子棋/象棋同款契约）", () => {
  it("撤 2 手后盘面/手数/轮转复原，superko seen 已删（同点可重落不误拒）", () => {
    const g = createGoGame({ size: 9 });
    expect(g.apply(0, "E5").ok).toBe(true);
    expect(g.apply(1, "E6").ok).toBe(true);
    const snapMid = g.getState();
    expect(snapMid.moveCount).toBe(2);
    expect(g.undoPlies(2)).toBe(2);
    const st = g.getState();
    expect(st.moveCount).toBe(0);
    expect(st.turn).toBe(0);
    expect(st.board.every((row) => row.every((v) => v === 0))).toBe(true); // 全空（二维数组）
    expect(g.pendingAction().seat).toBe(0);
    expect(g.apply(0, "E5").ok).toBe(true); // seen 未删则此处被 superko 拒
  });
  it("提子后悔棋：被提子复活、提子数回退、重提照常", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "pass");
    g.apply(1, "E5"); // 白孤子
    g.apply(0, "D5");
    g.apply(1, "pass");
    g.apply(0, "F5");
    g.apply(1, "pass");
    g.apply(0, "E6");
    g.apply(1, "pass");
    const r = g.apply(0, "E4"); // 四围提 E5
    expect(r.ok).toBe(true);
    expect(g.getState().captures[0]).toBe(1);
    expect(g.getState().board[4][4]).toBe(0); // E5 已被提
    expect(g.undoPlies(1)).toBe(1);
    const st = g.getState();
    expect(st.captures[0]).toBe(0);
    expect(st.board[4][4]).toBe(2); // E5 白子复活
    expect(g.apply(0, "E4").ok).toBe(true); // 重提照常
    expect(g.getState().captures[0]).toBe(1);
  });
  it("pass 可撤（连续 pass 计数回退）；双 pass 终局撤销后对局复活", () => {
    const g = createGoGame({ size: 9 });
    g.apply(0, "pass");
    expect(g.getState().passes).toBe(1);
    g.undoPlies(1);
    expect(g.getState().passes).toBe(0);
    expect(g.getState().turn).toBe(0);
    g.apply(0, "pass");
    g.apply(1, "pass");
    expect(g.result()).not.toBeNull(); // 双 pass 终局
    g.undoPlies(2);
    expect(g.result()).toBeNull(); // 复活
    expect(g.pendingAction().seat).toBe(0);
  });
});
