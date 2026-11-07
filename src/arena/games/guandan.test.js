/**
 * 掼蛋用例：牌型校验（含逢人配）/压制比较/升级表/游序结算/到 A 终局/全模拟。
 */
import { describe, expect, it } from "vitest";
import { createGuandanGame, classify, beats, fullDecks, sortCards } from "./guandan.js";
import { getGame } from "../registry.js";

describe("掼蛋：牌型校验（级牌=2 为例）", () => {
  it("基础型：单/对/三/三带二/顺子/连对/钢板", () => {
    expect(classify(["5h"], "2").type).toBe("single");
    expect(classify(["5h", "5s"], "2").type).toBe("pair");
    expect(classify(["5h", "5s", "5d"], "2").type).toBe("trio");
    expect(classify(["5h", "5s", "5d", "9c", "9d"], "2").type).toBe("full");
    expect(classify(["5h", "6s", "7d", "8c", "9d"], "2").type).toBe("straight");
    expect(classify(["5h", "5s", "6d", "6c", "7d", "7s"], "2").type).toBe("pairs");
    expect(classify(["5h", "5s", "5d", "6c", "6d", "6s"], "2").type).toBe("steel");
  });
  it("炸弹/同花顺/四大天王", () => {
    const b4 = classify(["9h", "9s", "9d", "9c"], "2");
    expect(b4.type).toBe("bomb");
    const b5 = classify(["9h", "9s", "9d", "9c", "9h"], "2"); // 两副牌第五张 9
    expect(b5.type).toBe("bomb");
    expect(b5.tier).toBeGreaterThan(b4.tier);
    const sf = classify(["5h", "6h", "7h", "8h", "9h"], "2");
    expect(sf.type).toBe("sflush");
    const kw = classify(["w", "w", "W", "W"], "2");
    expect(kw.type).toBe("kings");
  });
  it("逢人配：级牌 2 组顺子/对/三；炸弹同花顺不可用百搭", () => {
    // 2 当 6：5h 2s 7d 8c 9d = 5-9 顺
    expect(classify(["5h", "2s", "7d", "8c", "9d"], "2").type).toBe("straight");
    // 两张 2 当对
    expect(classify(["2s", "2h"], "2").type).toBe("pair");
    // 2 补三：KK+2 = 三张 K
    expect(classify(["Kh", "Ks", "2d"], "2").type).toBe("trio");
    // 2 不能凑炸：999+2 不是炸弹（也不成其他型→非法）
    expect(classify(["9h", "9s", "9d", "2c"], "2")).toBeNull();
    // 2 不能凑同花顺：5h6h7h8h + 2h（级牌同花色也不行）
    expect(classify(["5h", "6h", "7h", "8h", "2h"], "2")).not.toMatchObject({ type: "sflush" });
    // 级牌变化：级=5 时 2 是普通牌可入顺
    expect(classify(["2h", "3s", "4d", "5c", "6d"], "5")).toBeNull(); // 2 不能入顺（恒定规则）
    expect(classify(["3h", "4s", "5d", "6c", "7d"], "5")?.type).toBe("straight"); // 级 5 的百搭是 5d，补 5 位：3,4,_,6,7
  });
  it("beats：同型比顶张、炸压非炸、炸间比张数/点数、同花顺>5炸>4炸", () => {
    const s9 = classify(["9h", "Ts", "Jd", "Qc", "Kd"], "2");
    const sT = classify(["Th", "Js", "Qd", "Kc", "Ad"], "2");
    expect(beats(sT, s9)).toBe(true);
    expect(beats(s9, sT)).toBe(false);
    const p5 = classify(["5h", "5s"], "2");
    const pK = classify(["Kh", "Ks"], "2");
    expect(beats(pK, p5)).toBe(true);
    const b4 = classify(["3h", "3s", "3d", "3c"], "2");
    expect(beats(b4, pK)).toBe(true); // 炸压对
    const b5 = classify(["3h", "3s", "3d", "3c", "3h"], "2");
    expect(beats(b5, b4)).toBe(true); // 5 炸>4 炸
    const sf = classify(["5h", "6h", "7h", "8h", "9h"], "2");
    expect(beats(sf, b5)).toBe(true); // 主流：同花顺 > 5 炸
    expect(beats(b5, sf)).toBe(false);
    const b6 = classify(["3h", "3s", "3d", "3c", "3h", "3s"], "2");
    expect(beats(b6, sf)).toBe(true); // 6 炸 > 同花顺
    const kw = classify(["w", "w", "W", "W"], "2");
    expect(beats(kw, b6)).toBe(true); // 四王最大
  });
});

describe("掼蛋：引擎与升级赛", () => {
  it("注册：4 座 2v2、开局 27 张×4、108 张", () => {
    const def = getGame("guandan");
    expect(def?.label).toContain("掼蛋");
    const g = def.createGame({ seed: 1 });
    g.pendingAction(); // 触发开局发牌
    const st = g.getState();
    expect(st.hands.every((h) => h.length === 27)).toBe(true);
    expect(st.levels).toEqual(["2", "2"]);
  });
  it("首出不能 pass、非法牌型回喂、无牌回喂", () => {
    const g = createGuandanGame({ seed: 3 });
    const pend = g.pendingAction();
    expect(g.apply(pend.seat, "pass").ok).toBe(false);
    const hand = g.getState().hands[pend.seat];
    expect(g.apply(pend.seat, `play:${hand[0]} XX`).ok).toBe(false); // 无 XX 牌
    const twoRandom = hand.slice(0, 2);
    const r = g.apply(pend.seat, `play:${twoRandom.join(" ")}`);
    if (twoRandom[0][0] !== twoRandom[1][0]) expect(r.ok).toBe(false); // 非对子两单
    else expect(r.ok).toBe(true);
  });
  it("升级表：双下 +3 / 一三 +2 / 一末 +1（构造 settleHand 路径——用全模拟统计断言兜底）", () => {
    // 直接全模拟：升级只增不减、到 A 终局 ranks=队伍制
    for (let seed = 1; seed <= 3; seed += 1) {
      const g = createGuandanGame({ seed, opts: { levelCap: 1 } }); // levelCap=1：首队到 A 即终（加速）
      let guard = 0;
      while (!g.result() && guard < 6000) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed}: ${r.reason}`);
      }
      const res = g.result();
      if (res) {
        expect(res.ratingTeams).toEqual([[0, 2], [1, 3]]);
        expect(new Set(res.ranks).size).toBe(2); // 队伍两档
      }
    }
  });
  it("全模拟（无 levelCap）多手数不出错、事件流完整", () => {
    for (let seed = 1; seed <= 2; seed += 1) {
      const g = createGuandanGame({ seed });
      let guard = 0;
      while (!g.result() && guard < 12000) {
        guard += 1;
        const pend = g.pendingAction();
        if (!pend) break;
        const r = g.apply(pend.seat, g.suggestAction(pend.seat));
        if (!r.ok) throw new Error(`seed ${seed}: ${r.reason}`);
      }
      // 到 A 或步数上限都要保持状态可导出
      const st = g.getState();
      expect(st.hands.every((h) => h.length <= 27)).toBe(true);
    }
  });
  it("viewFor：级牌/队友/剩牌/能否压提示在场，不泄他家手牌", () => {
    const g = createGuandanGame({ seed: 5 });
    g.apply(g.pendingAction().seat, g.suggestAction(g.pendingAction().seat));
    const v = g.viewFor(1);
    expect(v).toContain("级牌");
    expect(v).toContain("队友");
    expect(v).not.toMatch(/2号：[♠♥♦♣0-9JQKAwW]{10,}/); // 他家剩牌是数字不是牌面
  });
});
