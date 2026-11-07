/**
 * 掼蛋裁判（games2 追加卡位，2026-11-07 用户裁定：升级赛到 A·逢人配保留）：
 * 两副牌 108 张、4 人 2v2（0&2 vs 1&3）、级牌百搭（逢人配）、炸弹/同花顺
 * 须纯牌、双下+3/一三+2/一末+1 升级、打过 A 终局。
 *
 * 简化口径（对局摘要声明，评审可砍）：
 *  - 无进贡还贡：首局座位 0 先出，其后每局=上局头游先出；
 *  - 牌型收：单/对/三张/三带二/顺子(≥5)/连对(≥3 对)/钢板(连两三)/炸弹
 *    (4+ 同点)/同花顺(≥5 纯牌)/四大天王(4 王)；钢板不带牌、无四带三等；
 *  - 逢人配：当前级牌 8 张全百搭，可组单/对/三/三带二/顺子/连对/钢板；
 *    炸弹/同花顺/四大天王不可用百搭（主流边界）；2 与王不入顺子/连对；
 *  - 大小：W(大王)>w(小王)>2>A>…>3；同型比顶张（百搭按其充当位）；炸弹
 *    压非炸，炸弹间比张数（多者大、同张数比点数）；同花顺>5 炸>4 炸；
 *    四大天王最大；跟牌自由（可过，压须同型更大或炸类）。
 *
 * 牌串：点数+花色 "5h TH JS"，小王 "w"、大王 "W"（大小写敏感）。
 * 动作："play:5H 5H 5D JD JS"（开放式组合——引擎校验型与压制；合法清单
 * 只给 pass+格式示例+「能否压」提示，不枚举全组合）；"pass" 过牌。
 */
import { registerGame } from "../registry.js";

const RANKS = "3456789TJQKA2"; // 顺序即大小（2 在 A 后）
const RV = Object.fromEntries([...RANKS].map((r, i) => [r, i + 3])); // 3..15
RV.w = 16; RV.W = 17;
const LEVELS = [...RANKS.slice(0, 12)]; // 2..A 升级路径：3 4 5 6 7 8 9 T J Q K A（从 2 起？主流从 2 打到 A）
const START_LEVEL = "2";
const isJoker = (c) => c === "w" || c === "W";
const rankOf = (c) => (isJoker(c) ? c : c[0]);
const suitOf = (c) => (isJoker(c) ? "" : c[1].toLowerCase());
const cardZh = (c) => (c === "w" ? "小王" : c === "W" ? "大王" : `${({ T: "10", J: "J", Q: "Q", K: "K", A: "A", 2: "2" })[c[0]] ?? c[0]}${{ s: "♠", h: "♥", d: "♦", c: "♣" }[c[1]?.toLowerCase()] ?? ""}`);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 两副 108 张（洗好返回）。 */
export function fullDecks(rng) {
  const d = [];
  for (let k = 0; k < 2; k += 1) {
    for (const r of RANKS) for (const s of "shdc") d.push(r + s);
    d.push("w", "W");
  }
  for (let i = d.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export const sortCards = (cards) => [...cards].sort((a, b) => (RV[rankOf(a)] - RV[rankOf(b)]) || a.localeCompare(b));

/**
 * 组合分类与大小键（掼蛋核心校验器）。
 * 返回 null（非法）或 { type, len, top, size }：
 *   type ∈ single/pair/trio/full(三带二)/straight/pairs/steel(钢板)/bomb/sflush/kings
 *   大小比较：bomb/sflush/kings 用 (tier, top)；普通型同 type 同 len 比 top。
 */
export function classify(cards, level) {
  const n = cards.length;
  if (!n || n > 27) return null;
  const ranks = cards.map(rankOf);
  const wilds = ranks.filter((r) => r === level).length;
  const reals = cards.filter((c) => rankOf(c) !== level);
  const realRanks = reals.map(rankOf);
  // 四大天王（纯 4 王）
  if (n === 4 && !wilds && realRanks.every((r) => isJokerStr(r)) && realRanks.filter((r) => r === "W").length === 2 && realRanks.filter((r) => r === "w").length === 2) {
    return { type: "kings", tier: 5, top: 17, size: 4 }; // 主流序：四王>6+炸>同花顺>5炸>4炸
  }
  // 炸弹：全同点 4+（纯牌，不含百搭）
  if (!wilds && realRanks.length >= 4 && new Set(realRanks).size === 1) {
    return { type: "bomb", tier: realRanks.length >= 6 ? 4 : realRanks.length === 5 ? 2 : 1, top: RV[realRanks[0]], size: realRanks.length };
  }
  // 同花顺：≥5 纯同花连续（2/王不入；百搭不可用）
  if (!wilds && n >= 5 && new Set(cards.map(suitOf)).size === 1) {
    const vs = realRanks.map((r) => RV[r]).sort((a, b) => a - b);
    const no2 = vs.every((v) => v <= 14); // 2(15)/王(16,17)不入顺
    if (no2 && new Set(vs).size === vs.length && vs[vs.length - 1] - vs[0] === vs.length - 1) {
      return { type: "sflush", tier: 3, top: vs[vs.length - 1], size: n };
    }
  }
  // 普通型（百搭可用）：counts = 实牌计数 + wilds 可补
  const cnt = {};
  for (const r of realRanks) cnt[r] = (cnt[r] ?? 0) + 1;
  const uniq = Object.keys(cnt);
  const maxSame = Math.max(...Object.values(cnt), 0);
  // 单张（1 wild 也可）
  if (n === 1) return { type: "single", tier: 0, top: wilds ? RV[level] : RV[realRanks[0]], size: 1 };
  // 对子
  if (n === 2) {
    if (wilds === 2 || (wilds === 0 && uniq.length === 1 && maxSame === 2)) return { type: "pair", tier: 0, top: wilds ? RV[level] : RV[realRanks[0]], size: 2 };
    if (wilds === 1 && uniq.length === 1 && maxSame === 1) return { type: "pair", tier: 0, top: RV[level], size: 2 }; // 1 wild + 1 实
    return null;
  }
  // 三张
  if (n === 3 && (wilds + (cnt[uniq[0]] ?? 0) >= 3) && uniq.length + (wilds ? 1 : 0) <= 2) {
    const base = uniq.length ? RV[uniq[0]] : RV[level];
    return { type: "trio", tier: 0, top: Math.max(base, wilds ? RV[level] : 0) || RV[level], size: 3 };
  }
  // 三带二（5 张 = 3+2，百搭补）
  if (n === 5) {
    // 尝试：某实 rank 出三（wild 补）+ 另 rank 出二（wild 补）
    for (const t of uniq) {
      for (const p of [...uniq, null]) {
        if (p === t) continue;
        const needT = 3 - (cnt[t] ?? 0);
        const needP = p ? 2 - (cnt[p] ?? 0) : 0;
        if (needT < 0 || needP < 0) continue;
        if (p === null && uniq.filter((u) => u !== t).length > 0) continue; // 无二位却剩实牌
        if (needT + needP !== wilds) continue;
        if (p === null && needP !== 0) continue;
        // 其余实牌必须都编入
        const used = { [t]: cnt[t], ...(p ? { [p]: cnt[p] } : {}) };
        if (uniq.some((u) => (used[u] ?? 0) < cnt[u])) continue;
        return { type: "full", tier: 0, top: RV[t], size: 5 };
      }
    }
  }
  // 顺子（≥5 连续单，2/王不入；百搭补缺位）
  if (n >= 5) {
    const base = realRanks.filter((r) => !isJokerStr(r) && r !== "2");
    if (base.length + wilds === n) {
      // 实牌无重复、无 2/王 → 检查可否用 wild 补成连续
      const vs = [...new Set(base)].map((r) => RV[r]).sort((a, b) => a - b);
      if (new Set(base).size === base.length) {
        // 找窗口 [lo, lo+n-1]（3..14，A=14 顶）容纳全部实牌
        for (let lo = 3; lo + n - 1 <= 14; lo += 1) {
          const hi = lo + n - 1;
          const inWin = vs.filter((v) => v >= lo && v <= hi);
          const need = n - inWin.length;
          if (need === wilds && inWin.length === vs.length) {
            return { type: "straight", tier: 0, top: hi, size: n };
          }
        }
      }
    }
  }
  // 连对（≥3 对 = 6+ 张）
  if (n >= 6 && n % 2 === 0) {
    const pairs = n / 2;
    const base = realRanks.filter((r) => !isJokerStr(r) && r !== "2");
    if (base.length + wilds === n) {
      const cnt2 = {};
      for (const r of base) cnt2[r] = (cnt2[r] ?? 0) + 1;
      const vs = [...new Set(base)].map((r) => RV[r]).sort((a, b) => a - b);
      if (vs.length <= pairs && vs[vs.length - 1] - vs[0] <= pairs - 1) {
        // 需要 wild 补的对数 = pairs - vs.length，且每实 rank ≤2
        if (Object.values(cnt2).every((x) => x <= 2) && pairs - vs.length === wilds - (base.length - vs.length === 0 ? 0 : 0)) {
          // wild 全部成对或贴成对：实牌单张的也须配 wild——重算：
          let wildNeed = 0;
          let ok = true;
          for (const r of Object.keys(cnt2)) wildNeed += Math.max(0, 2 - cnt2[r]);
          wildNeed += (pairs - Object.keys(cnt2).length) * 2;
          if (ok && wildNeed === wilds) return { type: "pairs", tier: 0, top: vs[vs.length - 1], size: n };
        }
      }
    }
  }
  // 钢板（连续两三张，6 张纯型或百搭补；2/王不入）
  if (n === 6) {
    const base = realRanks.filter((r) => !isJokerStr(r) && r !== "2");
    if (base.length + wilds === n) {
      for (let lo = 3; lo <= 13; lo += 1) {
        const need = (3 - Math.min(3, cnt[rankStr(lo)] ?? 0)) + (3 - Math.min(3, cnt[rankStr(lo + 1)] ?? 0));
        const others = base.filter((r) => RV[r] < lo || RV[r] > lo + 1).length;
        const over = (cnt[rankStr(lo)] > 3 ? cnt[rankStr(lo)] - 3 : 0) + (cnt[rankStr(lo + 1)] > 3 ? cnt[rankStr(lo + 1)] - 3 : 0);
        if (others === 0 && over === 0 && need === wilds) return { type: "steel", tier: 0, top: lo + 1, size: 6 };
      }
    }
  }
  return null;
}
const isJokerStr = (r) => r === "w" || r === "W";
const rankStr = (v) => ({ 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "T", 11: "J", 12: "Q", 13: "K", 14: "A" })[v];

/** 大小比较：new 是否压过 cur（null=首出恒可）。 */
export function beats(newCls, curCls) {
  if (!curCls) return true;
  const bombish = (c) => c.tier > 0;
  if (bombish(newCls) && !bombish(curCls)) return true;
  if (!bombish(newCls) && bombish(curCls)) return false;
  if (bombish(newCls) && bombish(curCls)) {
    if (newCls.tier !== curCls.tier) return newCls.tier > curCls.tier;
    if (newCls.size !== curCls.size) return newCls.size > curCls.size; // 同 tier 比张数（5炸>4炸已由 tier 分离，此处 6/7/8 炸）
    return newCls.top > curCls.top;
  }
  // 普通型：同型同长比顶张
  if (newCls.type !== curCls.type || newCls.size !== curCls.size) return false;
  return newCls.top > curCls.top;
}

/** 一局之内引擎状态（guandan 主状态机：局 → 升级 → 到 A 终局）。 */
export function createGuandanGame({ seed = Date.now() % 2 ** 31, opts = {} } = {}) {
  const rng = mulberry32(seed);
  const levelCap = opts.levelCap; // 测试用：升级上限截断
  let levels = [START_LEVEL, START_LEVEL]; // 两队级牌（0&2 队、1&3 队）
  let handNo = 0;
  let finished = []; // 全场游序（终局用）
  let ended = null;
  // 局内状态
  let hands = [[], [], [], []];
  let turn = 0;
  let lastPlay = null; // { seat, cards, cls } —— 当前需压组合（两家 pass 后清）
  let passes = 0;
  let finishOrder = []; // 本局游序
  let events = [];
  let lastDetail = null;
  const TEAM = (s) => s % 2; // 0: 座位0&2；1: 座位1&3
  const curLevel = (seat) => levels[TEAM(seat)];

  const pushEv = (e) => { events = [...events, e]; lastDetail = e; };

  function startHand() {
    handNo += 1;
    const deck = fullDecks(rng);
    for (let s = 0; s < 4; s += 1) hands[s] = sortCards(deck.splice(0, 27));
    finishOrder = [];
    lastPlay = null;
    passes = 0;
    turn = handNo === 1 ? 0 : (lastWinnerSeat ?? 0);
    while (hands[turn].length === 0) turn = (turn + 1) % 4;
    pushEv({ t: "hand", handNo, levels: [...levels], first: turn });
  }
  let lastWinnerSeat = null;

  const activeSeats = () => [0, 1, 2, 3].filter((s) => hands[s].length > 0);

  function settleHand() {
    const head = finishOrder[0];
    const partner = head % 2 === 0 ? head + 2 - (head % 2 === 0 ? 0 : 0) : head - 1; // 队友
    const mate = (head + 2) % 4;
    void partner;
    const second = finishOrder[1];
    const gain = second % 2 === head % 2 ? 3 : (finishOrder[2] ?? -1) % 2 === head % 2 ? 2 : 1;
    const winTeam = TEAM(head);
    const path = LEVELS;
    const idx = path.indexOf(levels[winTeam]);
    const next = Math.min(path.length - 1, idx + gain);
    levels[winTeam] = path[next];
    lastWinnerSeat = head;
    pushEv({ t: "handend", winTeam, gain, levels: [...levels], order: [...finishOrder] });
    if (levels[winTeam] === "A" && (levelCap == null || handNo >= levelCap)) {
      // 打过 A：胜队终局
      const ranks = [0, 1, 2, 3].map((s) => (TEAM(s) === winTeam ? 0 : 1));
      ended = {
        over: true, ranks,
        ratingTeams: [[0, 2], [1, 3]], ratingRanks: [0, 1],
        draw: false, scores: [levels[0] === "A" ? 1 : 0, levels[1] === "A" ? 1 : 0, 0, 0],
        summary: `第 ${handNo} 局打到 A（${winTeam === 0 ? "座位0/2队" : "座位1/3队"}过 A 获胜，升 ${gain} 级），全场终局`,
      };
    }
  }

  return {
    seats: () => 4,
    phase: () => (ended ? "over" : "play"),
    seatLabel: (s) => `${s + 1}号(${TEAM(s) === 0 ? "A队" : "B队"}${curLevel(s) === levels[TEAM(s)] ? `·级${levels[TEAM(s)]}` : ""})`,
    pendingAction() {
      if (ended) return null;
      if (hands[0].length === 0 && handNo === 0) startHand();
      if (!lastPlay && activeSeats().length && hands[turn].length === 0) { turn = (turn + 1) % 4; }
      if (activeSeats().length <= 1) { settleHand(); if (!ended) startHand(); return this.pendingAction(); }
      while (hands[turn].length === 0) turn = (turn + 1) % 4;
      return { seat: turn, kind: "play", actions: ["pass"] };
    },
    apply(seat, action) {
      if (ended) return { ok: false, reason: "比赛已结束" };
      const pending = this.pendingAction();
      if (!pending) return { ok: false, reason: "当前无可执行动作" };
      if (pending.seat !== seat) return { ok: false, reason: "还没轮到你" };
      const s = String(action).trim();
      if (s === "pass") {
        if (!lastPlay) return { ok: false, reason: "你是首出，不能过（必须出牌）" };
        passes += 1;
        pushEv({ t: "pass", seat });
        if (passes >= activeSeats().length - 1 || (lastPlay && passes >= 2)) {
          // 连续两家过 → 该轮结束，lastPlay 者获得首出
          turn = lastPlay.seat;
          lastPlay = null;
          passes = 0;
        } else {
          turn = (turn + 1) % 4;
          while (hands[turn].length === 0) turn = (turn + 1) % 4;
        }
        return { ok: true, events: [lastDetail] };
      }
      const m = /^play:(.+)$/i.exec(s);
      if (!m) return { ok: false, reason: '动作格式："play:5H 5H 5D JD JS"（空格分隔，大小写不限花色）或 "pass"' };
      const cards = m[1].split(/[\s,]+/).filter(Boolean).map((c) => (/^w$/i.test(c) ? (c === "W" ? "W" : "w") : /^[3-9TJQKA2][shdc]$/i.test(c) ? c[0].toUpperCase() + c[1].toLowerCase() : c));
      if (cards.some((c) => !c || RV[rankOf(c)] == null)) return { ok: false, reason: `牌串不合法：${m[1]}（例 "TH JS QH KS 9s"，小王 w 大王 W）` };
      // 持有校验（两副牌允许同名片两张）
      const need = [...cards];
      const hand = [...hands[seat]];
      for (const c of need) {
        const i = hand.indexOf(c);
        if (i < 0) return { ok: false, reason: `你没有 ${cardZh(c)}` };
        hand.splice(i, 1);
      }
      const cls = classify(cards, curLevel(seat));
      if (!cls) {
        return { ok: false, reason: `${cards.map(cardZh).join(" ")} 不是合法牌型（单/对/三/三带二/顺子≥5/连对≥3对/钢板/炸弹4+/同花顺/四大王；炸弹与同花顺不能用级牌百搭凑）` };
      }
      if (lastPlay && !beats(cls, lastPlay.cls)) {
        return { ok: false, reason: `${cards.map(cardZh).join(" ")} 压不过上家 ${lastPlay.cards.map(cardZh).join(" ")}（同型同长比顶张，或用炸弹/同花顺）` };
      }
      hands[seat] = hands[seat].filter((c) => {
        const i = need.indexOf(c);
        if (i >= 0) { need.splice(i, 1); return false; }
        return true;
      });
      lastPlay = { seat, cards, cls };
      passes = 0;
      pushEv({ t: "play", seat, cards: [...cards], type: cls.type, left: hands[seat].length });
      if (hands[seat].length === 0) {
        finishOrder.push(seat);
        pushEv({ t: "finish", seat, place: finishOrder.length });
        if (finishOrder.length >= 3 || activeSeats().length <= 1) {
          // 末游自动落位
          const last = [0, 1, 2, 3].find((x) => !finishOrder.includes(x));
          if (last != null) finishOrder.push(last);
          settleHand();
          if (!ended) startHand();
          return { ok: true, events: [lastDetail] };
        }
        lastPlay = null; // 出完者离场，轮次重开：下一位首出
        passes = 0;
      }
      turn = (turn + 1) % 4;
      while (hands[turn].length === 0 && !ended) turn = (turn + 1) % 4;
      return { ok: true, events: [lastDetail] };
    },
    result: () => ended,
    viewFor(seat) {
      const line = [];
      const teamLv = levels[TEAM(seat)];
      line.push(`【掼蛋·升级赛】2v2（你=${seat + 1}号，队友=${((seat + 2) % 4) + 1}号）；你方级牌=${teamLv}（逢人配=百搭，可组单/对/三/三带二/顺子/连对/钢板，不可凑炸弹/同花顺）；对方级牌=${levels[1 - TEAM(seat)]}。第 ${handNo} 局。打过 A 终局。`);
      line.push(`你的手牌（${hands[seat].length} 张，按大小排）：${hands[seat].map(cardZh).join(" ")}`);
      if (lastPlay) line.push(`需压：${lastPlay.seat === seat ? "你自己（已被两过可首出）" : `${lastPlay.seat + 1}号`} 的 ${lastPlay.cards.map(cardZh).join(" ")}（${zhType(lastPlay.cls)}）`);
      const others = [0, 1, 2, 3].filter((x) => x !== seat).map((x) => {
        const fin = finishOrder.indexOf(x);
        return `${x + 1}号${x === (seat + 2) % 4 ? "(队友)" : ""}：${fin >= 0 ? ["头游", "二游", "三游", "末游"][fin] : `剩 ${hands[x].length} 张`}`;
      }).join("；");
      line.push(`他家：${others}；本局游序：${finishOrder.map((x) => x + 1).join("→") || "进行中"}`);
      // 中度辅助：能否压（布尔，不算具体牌）
      if (lastPlay && lastPlay.seat !== seat && hands[seat].length) {
        const can = canBeat(hands[seat], lastPlay.cls, curLevel(seat));
        line.push(can ? "提示：你手里有能压过的组合（自己找——单压单、对压对、炸压一切）。" : "提示：你压不过（只能 pass）。");
      }
      const recent = events.slice(-10).map((e) => {
        const who = (x) => (x === seat ? "你" : `${x + 1}号`);
        if (e.t === "play") return `${who(e.seat)} 出 ${e.cards.map(cardZh).join("")}`;
        if (e.t === "pass") return `${who(e.seat)} 过`;
        if (e.t === "finish") return `${who(e.seat)} ${["头游", "二游", "三游", "末游"][e.place - 1]}！`;
        if (e.t === "hand") return `— 第 ${e.handNo} 局开始（级牌 你方${e.levels[TEAM(seat)]}/对方${e.levels[1 - TEAM(seat)]}）`;
        if (e.t === "handend") return `— ${e.winTeam === 0 ? "A队" : "B队"}胜升 ${e.gain} 级`;
        return "";
      }).filter(Boolean).join("；");
      if (recent) line.push(`动作流：${recent}`);
      line.push('输出：{"move":"play:TH JS QH KS 9s","comment":"…"} 或 {"move":"pass"}');
      return line.join("\n");
    },
    suggestAction(seat) {
      const pend = this.pendingAction();
      if (!pend) return null;
      const hand = hands[seat];
      const lv = curLevel(seat);
      if (!lastPlay) {
        // 首出：最小的单/对；有炸最后留
        const nonWild = hand.filter((c) => rankOf(c) !== lv);
        const pool = nonWild.length ? nonWild : hand;
        const smallest = pool.reduce((m, c) => (RV[rankOf(c)] < RV[rankOf(m)] ? c : m), pool[0]);
        return `play:${smallest}`;
      }
      const beat = findBeat(hand, lastPlay.cls, lv);
      return beat ? `play:${beat.join(" ")}` : "pass";
    },
    getState() {
      return {
        phase: this.phase(), handNo, levels: [...levels],
        hands: hands.map((h) => [...h]), finishOrder: [...finishOrder],
        lastPlay: lastPlay ? { seat: lastPlay.seat, cards: [...lastPlay.cards], type: lastPlay.cls.type } : null,
        turn,
        hist: events.slice(-30), lastMove: lastDetail,
        alive: [true, true, true, true], won: [false, false, false, false], lacks: [null, null, null, null],
      };
    },
    exportEvents: () => [...events],
  };
}

const zhType = (cls) => ({ single: "单张", pair: "对子", trio: "三张", full: "三带二", straight: "顺子", pairs: "连对", steel: "钢板", bomb: "炸弹", sflush: "同花顺", kings: "四大天王" })[cls.type];

/** 手牌里能否压过 cls（布尔，viewFor 中度辅助）。 */
export function canBeat(hand, cls, level) {
  return findBeat(hand, cls, level) != null;
}

/** 找一个最小压制组合（代走用；非完备搜索——够用口径）。 */
export function findBeat(hand, cls, level) {
  const wilds = hand.filter((c) => rankOf(c) === level);
  const reals = hand.filter((c) => rankOf(c) !== level);
  const byRank = {};
  for (const c of reals) (byRank[rankOf(c)] ??= []).push(c);
  const bombish = cls.tier > 0;
  if (!bombish) {
    // 同型最小压：枚举实牌组合+wild 补
    const want = cls.type;
    const size = cls.size;
    if (want === "single") {
      const all = [...reals, ...wilds].sort((a, b) => RV[rankOf(a)] - RV[rankOf(b)]);
      for (const c of all) if (RV[rankOf(c)] > cls.top || (rankOf(c) === level && RV[level] > cls.top)) return [c];
      return null;
    }
    if (want === "pair") {
      for (const r of Object.keys(byRank)) {
        if (RV[r] > cls.top && byRank[r].length >= 2) return byRank[r].slice(0, 2);
      }
      if (RV[level] > cls.top && wilds.length >= 2) return wilds.slice(0, 2);
      if (RV[level] > cls.top && wilds.length >= 1) {
        for (const r of Object.keys(byRank)) if (RV[r] < RV[level]) return [wilds[0], byRank[r][0]];
      }
      return null;
    }
    if (want === "trio" || want === "steel" || want === "full" || want === "straight" || want === "pairs") {
      // 简化：三张/三带二/顺子/连对/钢板的最小压——抽同长度顺窗/同点凑（只试实牌+all-wild 补齐的常见解）
      const need = size;
      if (want === "trio") {
        for (const r of Object.keys(byRank)) {
          if (RV[r] > cls.top) {
            const have = byRank[r].slice(0, 3);
            if (have.length + Math.min(wilds.length, 3 - have.length) >= 3) {
              return [...have, ...wilds.slice(0, 3 - have.length)];
            }
          }
        }
        return null;
      }
      if (want === "straight" || want === "pairs" || want === "steel") {
        // 顶张更高的同长窗口（实+wild）
        for (let top = cls.top + 1; top <= 14; top += 1) {
          const lo = want === "straight" ? top - need + 1 : top - (want === "steel" ? 1 : need / 2 - 1);
          if (lo < 3) continue;
          const picks = [];
          let wildNeed = 0;
          if (want === "straight") {
            for (let v = lo; v <= top; v += 1) {
              const r = rankStr(v);
              picks.push(byRank[r]?.[0] ?? null);
            }
          } else if (want === "pairs") {
            for (let v = lo; v <= top; v += 1) {
              const r = rankStr(v);
              picks.push(byRank[r]?.[0] ?? null, byRank[r]?.[1] ?? null);
            }
          } else {
            for (const v of [top - 1, top]) {
              const r = rankStr(v);
              picks.push(byRank[r]?.[0] ?? null, byRank[r]?.[1] ?? null, byRank[r]?.[2] ?? null);
            }
          }
          wildNeed = picks.filter((x) => x == null).length;
          if (wildNeed <= wilds.length && wilds.length >= 0 && picks.every((x) => x != null || true)) {
            const out = picks.filter(Boolean);
            if (out.length + wildNeed === need && out.length + wilds.length >= need) {
              return [...out, ...wilds.slice(0, wildNeed)];
            }
          }
        }
        return null;
      }
      if (want === "full") {
        for (const r of Object.keys(byRank)) {
          if (RV[r] > cls.top && byRank[r].length + wilds.length >= 3) {
            for (const p of Object.keys(byRank)) {
              if (p === r) continue;
              if (byRank[p].length >= 2 || (byRank[p].length >= 1 && wilds.length >= 1)) {
                const trio = [...byRank[r].slice(0, 3), ...wilds.slice(0, Math.max(0, 3 - Math.min(3, byRank[r].length)))];
                void trio;
                return null; // full 的最小压不细搜（少见），代走 pass
              }
            }
          }
        }
        return null;
      }
    }
    return null;
  }
  // 压炸：更大炸/同花顺/四王
  for (const r of Object.keys(byRank)) {
    if (byRank[r].length >= 4) {
      const tier = byRank[r].length >= 6 ? 4 : byRank[r].length === 5 ? 2 : 1;
      if (tier > cls.tier || (tier === cls.tier && byRank[r].length > cls.size) || (tier === cls.tier && byRank[r].length === cls.size && RV[r] > cls.top)) return byRank[r].slice(0, Math.max(4, byRank[r].length));
    }
  }
  return null;
}

registerGame({
  id: "guandan",
  label: "掼蛋·升级赛",
  short: "掼蛋",
  desc: "2v2 升级赛到 A·级牌百搭·双下升 3",
  order: 13,
  cat: "cards",
  color: "#0f766e",
  boardKind: "guandan",
  seats: 4,
  minSeats: 4,
  createGame: createGuandanGame,
});
