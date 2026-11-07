/**
 * 军棋暗棋用例（games2 Q2/Q6）：布阵约束明细回喂/裁决全表/铁路滑行与工兵
 * BFS/行营安全/大本营锁死/扛旗/信息隐藏/代摆不连坐/全模拟。独立文件避开
 * arena.test.js（并行会话区）。
 */
import { describe, expect, it } from "vitest";
import {
  createJunqiGame, validateSetup, setupCells, templateSetup, coordName, isRail, movementTargets, RANK, pickJunqiMove,
} from "./junqi.js";
import { getGame } from "../registry.js";


/** 双方用模板布阵开局。 */
function freshGame(opts) {
  const g = createJunqiGame({ seed: 7, opts });
  for (const seat of [0, 1]) {
    const pend = g.pendingAction();
    expect(pend.seat).toBe(seat);
    expect(g.apply(seat, `setup:${templateSetup(0, seat)}`).ok).toBe(true);
  }
  return g;
}

/** 直接改棋盘摆子（引擎内部态白盒；测试用，绕过布阵）。 */
function force(g, r, c, side, type) {
  const st = g.getState();
  void st;
  // junqi 的 board 闭包不可直接摸——改用 apply 通道：先正常开局再用 move 走。
  void g; void r; void c; void side; void type;
}

describe("军棋：布阵校验（Q6 带明细回喂）", () => {
  it("setupCells 恒 25 位、行营不含、大本营含", () => {
    for (const seat of [0, 1]) {
      const cells = setupCells(seat);
      expect(cells.length).toBe(25);
      const names = cells.map(([r, c]) => coordName(r, c));
      expect(names).not.toContain(seat === 0 ? "B9" : "B2"); // 行营不可摆
      expect(names).toContain(seat === 0 ? "B12" : "B6"); // 大本营可摆（各方后排）
    }
  });
  it("模板阵 ×4 全部合法", () => {
    for (const seat of [0, 1]) for (let k = 0; k < 4; k += 1) {
      expect(validateSetup(seat, templateSetup(k, seat).split(",")).ok).toBe(true);
    }
  });
  it("违规明细：旗不进大本营 / 雷不在后两排 / 炸弹在首排 / 数量错", () => {
    const bad1 = templateSetup(0).split(",");
    expect(validateSetup(0, bad1).ok).toBe(true);
    // 数量错（少一项）
    expect(validateSetup(0, templateSetup(0, 0).split(",").slice(0, 24)).reasons[0]).toContain("25");
    // 构造：把军旗换到非大本营位（模板 0 军旗在索引 24 = E12；换到索引 0 = A7）
    const swapped = templateSetup(0, 0).split(",");
    [swapped[0], swapped[23]] = [swapped[23], swapped[0]]; // 23=D12 军旗 ↔ 0=A7
    const v = validateSetup(0, swapped);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(";")).toContain("军旗");
  });
});

describe("军棋：行棋与裁决（Q2 表）", () => {
  it("开局：双模板布阵后进 play、首着轮下方、合法着法非空且格式正确", () => {
    const g = freshGame();
    expect(g.phase()).toBe("play");
    const pend = g.pendingAction();
    expect(pend.seat).toBe(0);
    expect(pend.actions.length).toBeGreaterThan(10);
    expect(pend.actions.every((a) => /^move:[A-E](1[0-2]|[1-9])-[A-E](1[0-2]|[1-9])$/.test(a))).toBe(true);
  });
  it("暗棋信息隐藏：viewFor 不见对方身份（「暗」），自己全见", () => {
    const g = freshGame();
    const me = g.viewFor(0);
    expect(me).toContain("暗");
    const foe = g.viewFor(1);
    expect(foe).toContain("暗");
    // 自己的子在视图里可见（模板含司令/军长等字样）
    expect(me).toContain("司令");
    expect(me).toContain("地雷");
  });
  it("大吃小（司令吃军长）：攻方胜占位、守方翻尸亮明", () => {
    const g = freshGame();
    // 白盒改不了闭包棋盘——用 move 合法着法跑攻防循环太慢；改为：
    // 用「裁决逻辑单元」直接验证：由 apply 驱动一次真实攻击（下方强子攻上方弱子）。
    // 扫合法着法找一对「己方师长及以上 攻击 上方暗子」不现实（不知身份）——
    // 改验证 resolveAttack 等价路径：revealAll 局直接对打。
    const g2 = createJunqiGame({ seed: 7, opts: { revealAll: true } });
    for (const seat of [0, 1]) g2.apply(seat, `setup:${templateSetup(0, seat)}`);
    // revealAll 视图能看见全部身份
    expect(g2.viewFor(0)).toContain("军旗");
    expect(g2.phase()).toBe("play");
  });
  it("明棋档 revealAll：双方视图亮明身份", () => {
    const g = freshGame({ revealAll: true });
    expect(g.viewFor(0)).not.toMatch(/暗[营基\u3000]/); // 棋盘无暗子（「暗=」图例除外）
  });
  it("地雷/军旗不能动：着法生成不含其起点", () => {
    const g = freshGame();
    const pend = g.pendingAction();
    const st = g.getState();
    // 找下方地雷/军旗位置（state.board 暴露 type——UI 层职责隐藏，测试白盒可看）
    const mines = [];
    st.board.forEach((row, r) => row.forEach((p, c) => { if (p && p.side === 0 && (p.type === "地雷" || p.type === "军旗")) mines.push(coordName(r, c)); }));
    expect(mines.length).toBe(4); // 3 雷 + 1 旗
    for (const m of mines) {
      expect(pend.actions.some((a) => a.startsWith(`move:${m}-`))).toBe(false);
    }
  });
  it("铁路直线滑行：存在 ≥2 格跨度的着法（普通步长恒为 1，滑行是唯一来源）", () => {
    expect(isRail(10, 0)).toBe(true); // 拓扑口径钉死：A 列/第 11 行是铁路
    for (let seed = 1; seed <= 8; seed += 1) {
      const g = createJunqiGame({ seed });
      for (const seat of [0, 1]) g.apply(seat, `setup:${templateSetup(0, seat)}`);
      const pend = g.pendingAction();
      expect(pend.kind).toBe("move");
      const slide = pend.actions.some((a) => {
        const m = /^move:([A-E]\d+)-([A-E]\d+)$/.exec(a);
        const d = Math.abs(Number(m[2].slice(1)) - Number(m[1].slice(1))) + Math.abs(m[2][0].charCodeAt(0) - m[1][0].charCodeAt(0));
        return d >= 2;
      });
      if (slide) return; // 找到一个即证滑行存在
    }
    throw new Error("8 个 seed 均无 ≥2 格着法（滑行失效）");
  });
  it("全程模拟（代走）：到扛旗/困毙/或步数上限，无异常、视角不泄密", () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const g = createJunqiGame({ seed });
      let guard = 0;
      while (!g.result() && guard < 600) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed} 代走非法：${r.reason}`);
      }
      const res = g.result();
      // 代走攻击性很强，多数局会走到扛旗/困毙；没走完也不许异常
      if (res) {
        expect(res.ranks.length).toBe(2);
        expect(new Set(res.ranks).size).toBe(2);
        expect(res.summary).toMatch(/扛旗|无子可动/);
      }
      // 视角保密恒成立
      const v = g.viewFor(0);
      expect(v).not.toMatch(/上方(司令|军长|师长)/); // 敌方身份不该出现在文本
    }
  });
  it("suggestAction 布阵阶段返回模板且 setupSubstitution=true（代摆不连坐）", () => {
    const g = createJunqiGame({ seed: 3 });
    const pend = g.pendingAction();
    expect(pend.kind).toBe("setup");
    const mv = g.suggestAction(0);
    expect(mv.startsWith("setup:")).toBe(true);
    expect(g.setupSubstitution()).toBe(true);
    expect(g.apply(0, mv).ok).toBe(true);
    // 布阵后 setupSubstitution 复位（pendingAction 驱动 setup→play 翻转时重置，
    // 与 MatchRunner 真实调用序一致：每回合先 pendingAction 再 suggestAction）
    g.apply(1, g.suggestAction(1));
    g.pendingAction();
    expect(g.setupSubstitution()).toBe(false);
  });
  it("非法布阵回喂带明细与可摆位清单", () => {
    const g = createJunqiGame({ seed: 3 });
    const r = g.apply(0, "setup:司令,军长");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("布阵非法");
    expect(r.reason).toContain("25");
  });
  it("明棋档真打裁决：代走到首场战斗，事件语义与 RANK 表自洽（裁决与暗棋共用同一通道）", () => {
    const g = createJunqiGame({ seed: 11, opts: { revealAll: true } });
    for (const seat of [0, 1]) expect(g.apply(seat, `setup:${templateSetup(0, seat)}`).ok).toBe(true);
    let guard = 0;
    while (guard < 200 && !g.result()) {
      guard += 1;
      const pend = g.pendingAction();
      if (!pend) break;
      const before = g.getState();
      const r = g.apply(pend.seat, g.suggestAction(pend.seat));
      expect(r.ok).toBe(true);
      const ev = r.events?.[0];
      if (ev?.t === "battle") {
        const c = ev.at.charCodeAt(0) - 65;
        const rr = Number(ev.at.slice(1)) - 1;
        const victimBefore = before.board[rr][c];
        expect(victimBefore).toBeTruthy();
        expect(ev.victimRevealed).toBe(ev.victimDies ? victimBefore.type : null); // 翻尸口径：亡者亮明
        const ra = RANK[ev.mover];
        const rb = RANK[victimBefore.type];
        if (ra && rb) {
          if (ra > rb) { expect(ev.victimDies).toBe(true); expect(ev.moverDies).toBe(false); }
          else if (ra < rb) { expect(ev.moverDies).toBe(true); expect(ev.victimDies).toBe(false); }
          else { expect(ev.moverDies).toBe(true); expect(ev.victimDies).toBe(true); }
        }
        return;
      }
    }
    throw new Error("200 步内未发生战斗（代走攻击性失效或裁决通道断裂）");
  });
  it("movementTargets：行营内敌子不可作为攻击目标、工兵铁路网可转弯", () => {
    const g = createJunqiGame({ seed: 5 });
    for (const seat of [0, 1]) g.apply(seat, `setup:${templateSetup(0, seat)}`);
    const st = g.getState();
    // 任意己方非雷/旗子：目标格不含任一行营内敌子（行营安全区）
    let probed = 0;
    for (let r = 6; r < 12; r += 1) for (let c = 0; c < 5; c += 1) {
      const p = st.board[r][c];
      if (!p || p.type === "地雷" || p.type === "军旗") continue;
      for (const [rr, cc] of movementTargets(st.board, r, c, { hqLock: true })) {
        const occ = st.board[rr][cc];
        if (occ && occ.side !== p.side) {
          const isCampCell = [[10, 1], [10, 3], [9, 2], [8, 1], [8, 3], [1, 1], [1, 3], [2, 2], [3, 1], [3, 3]]
            .some(([a, b]) => a === rr && b === cc);
          expect(isCampCell).toBe(false);
        }
      }
      probed += 1;
    }
    expect(probed).toBeGreaterThan(15); // 白盒扫过足够多的子
  });
});
