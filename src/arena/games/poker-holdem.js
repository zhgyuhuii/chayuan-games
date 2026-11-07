/**
 * 德州扑克裁判（games2 追加卡位 2/2，用户裁定 2026-11-07）：4 人 NLHE 短桌、
 * 盲注 10/20、初始 2000、单场 8 手帽按最终筹码排名喂 TrueSkill。
 *
 * 简化口径（对局摘要声明，评审可砍）：
 *  - 最小加注简化：加注须「加注到」≥ 2×当前注（不追补前次加注额）；全压不受
 *    最小加注限制（不足额全压只算跟注，不重开行动——声明简化，主流重开规则砍）；
 *  - 边池标准算法（按投入分层，平分余数归首个顺位）；
 *  - 无 ante、无 straddle；破产者离场（无重买）；8 手帽到点按筹码排名；
 *  - 亮牌：摊牌全员亮；未摊牌（唯一未弃）不亮。
 *
 * 牌串："As Kh Td 7c"（点数 2-9 T J Q K A + 花色 s黑桃 h红桃 d方块 c梅花）。
 * 动作："fold" / "check" / "call" / "bet:<额度>"（本街首注）/ "raise:<加注到>"
 *       （本街累计到该额度）/ "allin"。
 */
import { registerGame } from "../registry.js";

export const RANKS = "23456789TJQKA";
export const SUITS = "shdc";
const RANK_V = Object.fromEntries([...RANKS].map((r, i) => [r, i + 2])); // 2..14
const BLIND_S = 10, BLIND_B = 20, START = 2000, HANDS = 8;

export function fullDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

/** 5 张评分：[类别, 关键牌…]（字典序可比）。类别 9 同花顺…1 高牌。 */
export function score5(cards) {
  const vs = cards.map((c) => RANK_V[c[0]]).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(vs)];
  // 顺子（含 A-5 轮子）
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // A2345
  }
  const cnt = {};
  for (const v of vs) cnt[v] = (cnt[v] ?? 0) + 1;
  const groups = Object.entries(cnt).map(([v, n]) => [n, Number(v)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = (excl) => vs.filter((v) => !excl.includes(v));
  if (flush && straightHigh) return [9, straightHigh];
  if (groups[0][0] === 4) return [8, groups[0][1], ...kick([groups[0][1]])];
  if (groups[0][0] === 3 && groups[1]?.[0] === 2) return [7, groups[0][1], groups[1][1]];
  if (flush) return [6, ...vs];
  if (straightHigh) return [5, straightHigh];
  if (groups[0][0] === 3) return [4, groups[0][1], ...kick([groups[0][1]])];
  if (groups[0][0] === 2 && groups[1]?.[0] === 2) return [3, Math.max(groups[0][1], groups[1][1]), Math.min(groups[0][1], groups[1][1]), ...kick([groups[0][1], groups[1][1]])];
  if (groups[0][0] === 2) return [2, groups[0][1], ...kick([groups[0][1]])];
  return [1, ...vs];
}

const cmpScore = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** 7 选 5 最佳。 */
export function eval7(cards) {
  let best = null;
  for (let a = 0; a < 7; a += 1) for (let b = a + 1; b < 7; b += 1) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    const s = score5(five);
    if (!best || cmpScore(s, best) > 0) best = s;
  }
  return best;
}

export function handName(s) {
  return ["", "高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"][s[0]] ?? "?";
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 座位状态渲染用。 */
const ST = { active: "active", folded: "folded", allin: "allin", out: "out" };

export function createPokerGame({ seed = Date.now() % 2 ** 31 } = {}) {
  const rng = mulberry32(seed);
  let handNo = 0;
  let button = 3; // 首手 button+1=0 → 座位 0 当庄
  let ended = null;
  // 每手重建
  let stacks = Array(4).fill(START);
  let holes = [[], [], [], []];
  let community = [];
  let street = "idle"; // idle → preflop → flop → turn → river → showdown
  let streetBet = 0; // 本街最高累计投入
  let committedStreet = [0, 0, 0, 0];
  let committedTotal = [0, 0, 0, 0];
  let status = Array(4).fill(ST.active);
  let actedThisRound = [false, false, false, false];
  let toAct = 0;
  let lastAggressor = -1;
  let events = [];
  let lastDetail = null;
  let deck1 = []; // 本手牌堆（startHand 装入，翻牌/转牌/河牌从这里发）

  const deck = () => {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  };

  const activeSeats = () => [0, 1, 2, 3].filter((s) => status[s] === ST.active || status[s] === ST.allin);
  const inHandSeats = () => [0, 1, 2, 3].filter((s) => status[s] !== ST.out && status[s] !== ST.folded);
  const pot = () => committedTotal.reduce((a, b) => a + b, 0);

  const pushEv = (e) => { events = [...events, e]; lastDetail = e; };

  /** 开新一手。 */
  function startHand() {
    handNo += 1;
    button = (button + 1) % 4;
    holes = [[], [], [], []];
    community = [];
    committedStreet = [0, 0, 0, 0];
    committedTotal = [0, 0, 0, 0];
    actedThisRound = [false, false, false, false];
    lastAggressor = -1;
    const d = deck();
    for (let s = 0; s < 4; s += 1) {
      if (stacks[s] <= 0) { status[s] = ST.out; continue; }
      status[s] = ST.active;
      holes[s] = [d.pop(), d.pop()];
    }
    deck1 = d; // 余 44 张供公共牌
    street = "preflop";
    // 盲注（button+1 SB, +2 BB；破产者顺延跳过）
    const nextLive = (from) => { let x = from % 4; let g = 0; while (g < 4 && status[x] === ST.out) { x = (x + 1) % 4; g += 1; } return x; };
    const sb = nextLive(button + 1), bb = sb === button ? sb : nextLive(sb + 1);
    postBlind(sb, BLIND_S);
    postBlind(bb, BLIND_B);
    streetBet = BLIND_B;
    toAct = (bb + 1) % 4;
    while (status[toAct] === ST.out || status[toAct] === ST.folded) toAct = (toAct + 1) % 4;
    pushEv({ t: "hand", handNo, button, sb, bb, holesDealt: inHandSeats().length });
  }

  function postBlind(seat, amt) {
    const a = Math.min(amt, stacks[seat]);
    stacks[seat] -= a;
    committedStreet[seat] += a;
    committedTotal[seat] += a;
    if (stacks[seat] === 0) status[seat] = ST.allin;
  }

  /** 本轮是否收口：所有非全压在手家都已行动且投入=streetBet。 */
  function bettingDone() {
    const live = [0, 1, 2, 3].filter((s) => status[s] === ST.active);
    if (live.length <= 1) return true;
    return live.every((s) => actedThisRound[s] && committedStreet[s] === streetBet);
  }

  /** 进下一街/摊牌。 */
  function advanceStreet() {
    if (street === "preflop") { community = [...community, ...deal3()]; street = "flop"; }
    else if (street === "flop") { community = [...community, draw1()]; street = "turn"; }
    else if (street === "turn") { community = [...community, draw1()]; street = "river"; }
    else { showdown(); return; }
    committedStreet = [0, 0, 0, 0];
    streetBet = 0;
    actedThisRound = [false, false, false, false];
    lastAggressor = -1;
    // 全压残局：无人可行动 → 连发到摊牌
    const live = [0, 1, 2, 3].filter((s) => status[s] === ST.active);
    if (live.length === 0) { advanceStreet(); return; }
    toAct = nextFrom(button, live);
    pushEv({ t: "street", street, community: [...community] });
  }

  const draw1 = () => deck1.pop();
  const deal3 = () => [deck1.pop(), deck1.pop(), deck1.pop()];

  function nextFrom(from, live) {
    let s = (from + 1) % 4;
    let guard = 0;
    while (guard < 8 && (!live.includes(s) || status[s] !== ST.active)) { s = (s + 1) % 4; guard += 1; }
    return s;
  }

  /** 标准边池分配：按投入分层，层内最佳手平分（余数给顺位最前者）。 */
  function distribute() {
    const contrib = [...committedTotal];
    const winners = [];
    let remaining = [0, 1, 2, 3].filter((s) => contrib[s] > 0);
    while (remaining.some((s) => contrib[s] > 0)) {
      const layer = Math.min(...remaining.filter((s) => contrib[s] > 0).map((s) => contrib[s]));
      let potAmt = 0;
      const eligible = [];
      for (const s of remaining) {
        if (contrib[s] <= 0) continue;
        potAmt += layer;
        contrib[s] -= layer;
        if (status[s] !== ST.folded && status[s] !== ST.out) eligible.push(s);
      }
      remaining = remaining.filter((s) => contrib[s] > 0);
      if (!eligible.length) { // 无人有资格（全弃层）→ 归最后在场者
        const last = inHandSeats()[0];
        if (last != null) { stacks[last] += potAmt; winners.push({ seat: last, amt: potAmt, hand: null }); }
        continue;
      }
      const scores = eligible.map((s) => ({ s, sc: eval7([...holes[s], ...community]) }));
      const best = scores.reduce((m, x) => (cmpScore(x.sc, m.sc) > 0 ? x : m));
      const ties = scores.filter((x) => cmpScore(x.sc, best.sc) === 0).map((x) => x.s);
      const share = Math.floor(potAmt / ties.length);
      let rem = potAmt - share * ties.length;
      for (const s of ties) {
        const amt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
        stacks[s] += amt;
        winners.push({ seat: s, amt, hand: handName(best.sc) });
      }
    }
    return winners;
  }

  function showdown() {
    street = "showdown";
    const live = inHandSeats();
    let winners;
    if (live.length === 1) {
      const w = live[0];
      const amt = pot();
      stacks[w] += amt;
      winners = [{ seat: w, amt, hand: null }];
      pushEv({ t: "win", seat: w, amt, uncontested: true });
    } else {
      winners = distribute();
      for (const w of winners) pushEv({ t: "win", seat: w.seat, amt: w.amt, hand: w.hand, holes: [...holes[w.seat]] });
    }
    endHand();
  }

  function endHand() {
    for (let s = 0; s < 4; s += 1) if (stacks[s] <= 0 && status[s] !== ST.out) status[s] = ST.out;
    const survivors = [0, 1, 2, 3].filter((s) => status[s] !== ST.out);
    if (handNo >= HANDS || survivors.length <= 1) {
      // 终局排名：筹码降序（破产 0 垫底按淘汰先后——简化并列）
      const order = [0, 1, 2, 3].sort((a, b) => stacks[b] - stacks[a]);
      const ranks = new Array(4);
      order.forEach((s, i) => { ranks[s] = i > 0 && stacks[s] === stacks[order[i - 1]] ? ranks[order[i - 1]] : i; });
      ended = { over: true, ranks, scores: [...stacks], draw: false, summary: `8 手帽完赛（第 ${handNo} 手收），最终筹码：${order.map((s) => `${s + 1}号 ${stacks[s]}`).join("、")}` };
      street = "over";
      return;
    }
    street = "idle";
    pushEv({ t: "handend", stacks: [...stacks] });
  }

  /** 合法动作清单。 */
  function legalActions(seat) {
    const acts = [];
    const need = streetBet - committedStreet[seat];
    if (need <= 0) {
      acts.push("check");
      const minTo = Math.max(streetBet + BLIND_B, BLIND_B * 2);
      if (stacks[seat] > 0) {
        if (stacks[seat] <= minTo - committedStreet[seat]) acts.push("allin");
        else acts.push(`bet:${minTo}`, "allin");
      }
    } else {
      if (need >= stacks[seat]) acts.push("allin");
      else {
        acts.push("call", "fold");
        const raiseTo = Math.max(streetBet * 2, committedStreet[seat] + BLIND_B);
        if (stacks[seat] - committedStreet[seat] > need && stacks[seat] >= raiseTo) acts.push(`raise:${raiseTo}`, "allin");
      }
    }
    return acts;
  }

  return {
    seats: () => 4,
    phase: () => (ended ? "over" : street),
    seatLabel: (s) => (s === button ? "庄 BTN" : `${s + 1}号`),
    pendingAction() {
      if (ended || street === "over" || street === "showdown") return null;
      if (street === "idle") startHand(); // 手间自启：跑者首问即开局
      const live = [0, 1, 2, 3].filter((s) => status[s] === ST.active);
      if (!live.length) return null;
      return { seat: toAct, kind: "bet", actions: legalActions(toAct) };
    },
    apply(seat, action) {
      if (ended) return { ok: false, reason: "比赛已结束" };
      if (street === "idle") { startHand(); return { ok: true, events: [lastDetail] }; }
      const pending = this.pendingAction();
      if (!pending) { // 本街收口自动推进
        advanceStreet();
        return { ok: true, events: [lastDetail] };
      }
      if (pending.seat !== seat) return { ok: false, reason: "还没轮到你" };
      const s = String(action).trim().toLowerCase();
      const acts = pending.actions;
      const commit = (amt) => { // amt=本街新增投入
        const a = Math.min(amt, stacks[seat]);
        stacks[seat] -= a;
        committedStreet[seat] += a;
        committedTotal[seat] += a;
        if (stacks[seat] === 0) status[seat] = ST.allin;
        return a;
      };
      const closeOrPass = () => {
        if (bettingDone()) advanceStreet();
        else {
          toAct = nextFrom(seat, [0, 1, 2, 3].filter((x) => status[x] === ST.active));
          // 若只剩全压者待行动空转 → 推进
          if (status[toAct] !== ST.active) { advanceStreet(); }
        }
      };
      if (s === "fold") {
        status[seat] = ST.folded;
        pushEv({ t: "fold", seat });
        const live = inHandSeats();
        if (live.length === 1) showdown();
        else closeOrPass();
        return { ok: true, events: [lastDetail] };
      }
      if (s === "check") {
        if (!acts.includes("check")) return { ok: false, reason: "有人下注，不能 check（可 call/fold）" };
        actedThisRound[seat] = true;
        pushEv({ t: "check", seat });
        closeOrPass();
        return { ok: true, events: [lastDetail] };
      }
      if (s === "call") {
        if (!acts.includes("call")) return { ok: false, reason: "无人下注时用 check（或 bet/allin）" };
        const a = commit(streetBet - committedStreet[seat]);
        actedThisRound[seat] = true;
        pushEv({ t: "call", seat, amt: a, to: committedStreet[seat] });
        closeOrPass();
        return { ok: true, events: [lastDetail] };
      }
      if (s === "allin") {
        const a = commit(stacks[seat]);
        if (committedStreet[seat] > streetBet) { streetBet = committedStreet[seat]; lastAggressor = seat; for (let x = 0; x < 4; x += 1) if (x !== seat) actedThisRound[x] = false; }
        actedThisRound[seat] = true;
        pushEv({ t: "allin", seat, amt: a, to: committedStreet[seat] });
        closeOrPass();
        return { ok: true, events: [lastDetail] };
      }
      const bm = /^bet:(\d+)$/.exec(s);
      if (bm) {
        const amt = Number(bm[1]);
        if (!acts.some((x) => x.startsWith("bet:"))) return { ok: false, reason: "本街已有下注，用 raise:<加注到> 或 call/fold" };
        if (amt < BLIND_B) return { ok: false, reason: `最小下注 ${BLIND_B}` };
        if (amt > stacks[seat]) return { ok: false, reason: `筹码不足（你只有 ${stacks[seat]}）` };
        commit(amt);
        streetBet = committedStreet[seat];
        lastAggressor = seat;
        for (let x = 0; x < 4; x += 1) if (x !== seat) actedThisRound[x] = false;
        actedThisRound[seat] = true;
        pushEv({ t: "bet", seat, amt, to: committedStreet[seat] });
        closeOrPass();
        return { ok: true, events: [lastDetail] };
      }
      const rm = /^raise:(\d+)$/.exec(s);
      if (rm) {
        const to = Number(rm[1]);
        if (!acts.some((x) => x.startsWith("raise:"))) return { ok: false, reason: "当前无注可加（用 bet:<额度>）" };
        if (to < streetBet * 2) return { ok: false, reason: `最小加注到 ${Math.max(streetBet * 2, BLIND_B * 2)}（当前注 ${streetBet}）` };
        if (to - committedStreet[seat] > stacks[seat]) return { ok: false, reason: `筹码不足（加注到 ${to} 需再投 ${to - committedStreet[seat]}，你只有 ${stacks[seat]}）` };
        commit(to - committedStreet[seat]);
        streetBet = committedStreet[seat];
        lastAggressor = seat;
        for (let x = 0; x < 4; x += 1) if (x !== seat) actedThisRound[x] = false;
        actedThisRound[seat] = true;
        pushEv({ t: "raise", seat, to, amt: to });
        closeOrPass();
        return { ok: true, events: [lastDetail] };
      }
      return { ok: false, reason: `动作格式：fold / check / call / bet:<额度> / raise:<加注到> / allin（你可用：${acts.join(" ")}）` };
    },
    result: () => ended,
    viewFor(seat) {
      const line = [];
      const streetZh = { preflop: "翻前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌", idle: "手间", over: "结束" };
      line.push(`【德州扑克 NLHE】4 人短桌·盲注 ${BLIND_S}/${BLIND_B}·第 ${handNo}/${HANDS} 手·${streetZh[street] ?? street}。底池 ${pot()}。你（${seat + 1} 号）筹码 ${stacks[seat]}。最小加注=加注到 2×当前注；全压不受限。`);
      line.push(`你的底牌：${holes[seat].join(" ") || "未发"}${holes[seat].length === 2 ? `（${handName(score5(holes[seat]))}起手单算——仅参考）` : ""}`);
      line.push(`公共牌：${community.join(" ") || "（未发）"}${community.length >= 3 && holes[seat].length === 2 ? `—— 你当前最佳：${handName(eval7([...holes[seat], ...community]))}` : ""}`);
      const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => {
        const stZh = { active: status[s] === ST.active && committedStreet[s] > 0 ? `已投${committedStreet[s]}` : "行动中", folded: "已弃牌", allin: "全压", out: "出局" }[status[s]];
        return `${s + 1}号${s === button ? "(BTN)" : ""}：筹码${stacks[s]}，${stZh}${status[s] === ST.allin ? `（共投${committedTotal[s]}）` : ""}`;
      }).join("；");
      line.push(`对手：${others}`);
      const need = streetBet - committedStreet[seat];
      if (need > 0 && status[seat] === ST.active) {
        const potOdds = Math.round((need / (pot() + need)) * 100);
        line.push(`跟注需 ${Math.min(need, stacks[seat])}，底池赔率约 ${potOdds}%（跟注额/(底池+跟注额)——仅数学参考，不含诈唬判断）。`);
      }
      const recent = events.slice(-8).map((e) => {
        const who = (x) => (x === seat ? "你" : `${x + 1}号`);
        switch (e.t) {
          case "bet": return `${who(e.seat)} 下注 ${e.amt}`;
          case "raise": return `${who(e.seat)} 加注到 ${e.to}`;
          case "call": return `${who(e.seat)} 跟注`;
          case "check": return `${who(e.seat)} 过牌`;
          case "fold": return `${who(e.seat)} 弃牌`;
          case "allin": return `${who(e.seat)} 全压！`;
          case "street": return `→ ${({ flop: "翻牌", turn: "转牌", river: "河牌" })[e.street] ?? e.street} ${e.community.join(" ")}`;
          case "win": return `${who(e.seat)} ${e.uncontested ? "未被跟注收池" : `以${e.hand ?? "?"}赢 ${e.amt}`}`;
          default: return "";
        }
      }).filter(Boolean).join("；");
      if (recent) line.push(`动作流（旧→新）：${recent}`);
      const pend = this.pendingAction();
      if (pend && pend.seat === seat) line.push(`轮到你。可行动作：${pend.actions.join(" ")}`);
      return line.join("\n");
    },
    suggestAction(seat) {
      const pend = this.pendingAction();
      if (!pend) return null;
      const acts = pend.actions;
      if (acts.includes("check")) return "check";
      if (acts.includes("call")) {
        const need = streetBet - committedStreet[seat];
        if (need <= pot() * 0.6) return "call"; // 便宜就跟（弱策略声明）
        return Math.random() < 0.15 && acts.some((a) => a.startsWith("raise:")) ? acts.find((a) => a.startsWith("raise:")) : "fold";
      }
      const bet = acts.find((a) => a.startsWith("bet:"));
      if (bet && Math.random() < 0.3) return bet;
      return "check" === acts[0] ? "check" : (acts.includes("allin") && Math.random() < 0.05 ? "allin" : (bet ?? acts[0]));
    },
    getState() {
      return {
        phase: this.phase(), handNo, button,
        stacks: [...stacks], pot: pot(), community: [...community],
        streetBet, committedStreet: [...committedStreet],
        status: [...status], toAct,
        holes: holes.map((h) => [...h]),
        hist: events.slice(-24), lastMove: lastDetail,
        alive: status.map((s) => s !== ST.out), won: [false, false, false, false], lacks: [null, null, null, null],
      };
    },
    exportEvents: () => [...events],
  };
}

registerGame({
  id: "poker",
  label: "德州扑克",
  short: "德扑",
  desc: "4 人 NLHE·盲注 10/20·8 手帽按筹码排名",
  order: 12,
  cat: "cards",
  color: "#1f6f43",
  boardKind: "poker",
  seats: 4,
  minSeats: 4,
  createGame: createPokerGame,
});
