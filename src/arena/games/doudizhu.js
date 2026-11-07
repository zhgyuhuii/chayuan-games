/**
 * 斗地主规则状态机（games-llm-arena-plan Q3：3 人 2v1，RLCard doudizhu env
 * （MIT）规则语义的 TS/JS 移植——移植规则不移植代码；DouZero 权重按 Q1 出局）。
 *
 * 规则口径：54 张牌；发 17×3 + 3 底牌；叫分制（每人一次机会叫 1/2/3 或不叫，
 * 叫 3 立即成局，最高者当地主并取底牌；全不叫重发，最多 3 次后强制首叫者
 * 1 分成局——防死循环）。牌型：单/对/三/三带一/三带二/顺子(≥5)/连对(≥3)/
 * 飞机(可带单/带对)/四带二/四带两对/炸弹/火箭。倍数：每个炸弹或火箭 ×2、
 * 春天 ×2、反春天 ×2。底分 = 叫分。
 *
 * 出招协议（Q3 合作上下文）：农民视角显式标注队友出牌记录与剩牌数——
 * 「大模型会不会配合」是评测维度。
 *
 * 牌面字符：3456789T J Q K A 2 X(小王) D(大王)；LLM 写 "10" 自动归一为 T。
 * 动作：叫牌 "bid:0..3"；出牌 "play:PASS" 或 "play:34567"（顺序任意）。
 */
import { registerGame } from "../registry.js";

export const RANK_OF = { "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14, "2": 15, X: 16, D: 17 };
const CH_OF = { 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "小王", 17: "大王" };

const byRank = (a, b) => RANK_OF[a] - RANK_OF[b];
export const sortCards = (cards) => [...cards].sort(byRank);
/** 牌串解析：忽略分隔符、"10"→T、小写归大写。非法字符返回 null。 */
export function normalizeCards(s) {
  if (typeof s !== "string") return null;
  const up = s.toUpperCase().replace(/[\s,，、-]/g, "");
  const out = [];
  for (let i = 0; i < up.length; i += 1) {
    let ch = up[i];
    if (ch === "1" && up[i + 1] === "0") { ch = "T"; i += 1; }
    if (ch === "0") ch = "T";
    if (!(ch in RANK_OF)) return null;
    out.push(ch);
  }
  return out;
}

export function fullDeck() {
  const d = [];
  for (const ch of Object.keys(RANK_OF)) {
    if (ch === "X" || ch === "D") d.push(ch);
    else for (let i = 0; i < 4; i += 1) d.push(ch);
  }
  return d;
}

/** 牌型识别；不合法返回 null。 */
export function parseType(cards) {
  const n = cards.length;
  if (n === 0) return { type: "pass", rank: 0, len: 0 };
  const counts = new Map();
  for (const c of cards) counts.set(RANK_OF[c], (counts.get(RANK_OF[c]) ?? 0) + 1);
  const vals = [...counts.keys()].sort((a, b) => a - b);
  const g = { 1: [], 2: [], 3: [], 4: [] };
  for (const v of vals) g[counts.get(v)].push(v);
  const consec = (arr) => arr.length > 0 && arr[arr.length - 1] - arr[0] === arr.length - 1;
  const chainOk = (arr) => consec(arr) && arr[0] >= 3 && arr[arr.length - 1] <= 14; // 不含 2/王
  if (n === 1) return { type: "single", rank: vals[0], len: 1 };
  if (n === 2) {
    if (cards.includes("X") && cards.includes("D")) return { type: "rocket", rank: 99, len: 1 };
    if (vals.length === 1) return { type: "pair", rank: vals[0], len: 1 };
    return null;
  }
  if (n === 4 && vals.length === 1) return { type: "bomb", rank: vals[0], len: 1 };
  if (n === 3 && vals.length === 1) return { type: "trio", rank: vals[0], len: 1 };
  if (n === 4 && g[3].length === 1) return { type: "trio1", rank: g[3][0], len: 1 };
  if (n === 5 && g[3].length === 1 && g[2].length === 1) return { type: "trio2", rank: g[3][0], len: 1 };
  if (n >= 5 && vals.length === n && chainOk(vals)) return { type: "straight", rank: vals[0], len: n };
  if (n >= 6 && n % 2 === 0 && g[2].length === n / 2 && chainOk(g[2])) return { type: "pairStraight", rank: g[2][0], len: n / 2 };
  if (g[3].length >= 2 && chainOk(g[3])) {
    const k = g[3].length;
    if (n === 3 * k) return { type: "plane", rank: g[3][0], len: k };
    if (n === 4 * k) return { type: "plane1", rank: g[3][0], len: k };
    if (n === 5 * k && g[2].length === k && g[1].length === 0 && g[4].length === 0) return { type: "plane2", rank: g[3][0], len: k };
  }
  if (n === 6 && g[4].length === 1) return { type: "four2", rank: g[4][0], len: 1 };
  if (n === 8 && g[4].length === 1 && g[2].length === 2) return { type: "four22", rank: g[4][0], len: 1 };
  return null;
}

/** a 能否压 b（b 为场上的牌）。 */
export function beats(a, b) {
  if (!a || !b) return false;
  if (a.type === "rocket") return true;
  if (b.type === "rocket") return false;
  if (a.type === "bomb" && b.type !== "bomb") return true;
  if (b.type === "bomb" && a.type !== "bomb") return false;
  if (a.type !== b.type || a.len !== b.len) return false;
  return a.rank > b.rank;
}

const TYPE_ZH = { single: "单张", pair: "对子", trio: "三张", trio1: "三带一", trio2: "三带二", straight: "顺子", pairStraight: "连对", plane: "飞机", plane1: "飞机带单", plane2: "飞机带对", four2: "四带二", four22: "四带两对", bomb: "炸弹", rocket: "火箭" };
export const cardsText = (cards) => cards.length ? sortCards(cards).map((c) => CH_OF[RANK_OF[c]]).join(" ") : "不要";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 枚举 hand 中能压 lastType 的最小应手（代走用，质量不求高）。 */
export function cheapestResponse(hand, lastType) {
  const counts = new Map();
  for (const c of hand) counts.set(RANK_OF[c], (counts.get(RANK_OF[c]) ?? 0) + 1);
  const vals = [...counts.keys()].sort((a, b) => a - b);
  const pick = (rank, k) => hand.filter((c) => RANK_OF[c] === rank).slice(0, k);
  const tryType = (type, len) => {
    if (lastType.type !== type || lastType.len !== len) return null;
    for (const v of vals) {
      if (v > lastType.rank && (counts.get(v) ?? 0) >= { single: 1, pair: 2, trio: 3, trio1: 3, trio2: 3 }[type]) {
        if (type === "trio1") {
          const wing = vals.find((w) => w !== v && (counts.get(w) ?? 0) >= 1);
          if (wing == null) break;
          return sortCards([...pick(v, 3), ...pick(wing, 1)]);
        }
        if (type === "trio2") {
          const wing = vals.find((w) => w !== v && (counts.get(w) ?? 0) >= 2);
          if (wing == null) break;
          return sortCards([...pick(v, 3), ...pick(wing, 2)]);
        }
        return pick(v, { single: 1, pair: 2, trio: 3, trio1: 3, trio2: 3 }[type]);
      }
    }
    return null;
  };
  if (["single", "pair", "trio", "trio1", "trio2"].includes(lastType.type)) {
    const r = tryType(lastType.type, 1);
    if (r) return r;
  }
  if (["straight", "pairStraight", "plane", "plane1", "plane2"].includes(lastType.type)) {
    // 同长窗口顺推
    const unit = { straight: 1, pairStraight: 2, plane: 3, plane1: 3, plane2: 3 }[lastType.type];
    const width = lastType.len;
    for (let start = lastType.rank + 1; start + width - 1 <= 14; start += 1) {
      let ok = true;
      for (let v = start; v < start + width; v += 1) if ((counts.get(v) ?? 0) < unit) { ok = false; break; }
      if (!ok) continue;
      const body = [];
      for (let v = start; v < start + width; v += 1) body.push(...pick(v, unit));
      if (lastType.type === "plane1") {
        const wings = vals.filter((w) => w < start || w >= start + width).sort((a, b) => a - b).slice(0, width).flatMap((w) => pick(w, 1));
        if (wings.length < width) continue;
        return sortCards([...body, ...wings]);
      }
      if (lastType.type === "plane2") {
        const wingVals = vals.filter((w) => (w < start || w >= start + width) && counts.get(w) >= 2).slice(0, width);
        if (wingVals.length < width) continue;
        return sortCards([...body, ...wingVals.flatMap((w) => pick(w, 2))]);
      }
      return sortCards(body);
    }
  }
  // 炸弹兜底（对火箭无解——炸弹压不过火箭）
  if (lastType.type !== "rocket") {
    const bomb = vals.find((v) => counts.get(v) === 4 && (lastType.type !== "bomb" || v > lastType.rank));
    if (bomb != null) return pick(bomb, 4);
    if (hand.includes("X") && hand.includes("D")) return ["X", "D"];
  }
  return null;
}

export function createDoudizhuGame({ seed = Date.now() % 2 ** 31, firstBid = 0 } = {}) {
  const rng = mulberry32(seed);
  let hands;
  let bottom;
  let redeals = 0;
  const deal = () => {
    const deck = fullDeck();
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    hands = [sortCards(deck.slice(0, 17)), sortCards(deck.slice(17, 34)), sortCards(deck.slice(34, 51))];
    bottom = sortCards(deck.slice(51));
  };
  deal();

  let phase = "bid"; // bid → play
  let landlord = null;
  let bidScore = 0;
  const bids = []; // { seat, score }
  let bidTurn = firstBid;
  const plays = []; // { seat, cards, pass }
  let trick = null; // 场上牌 { seat, cards, type }
  let passes = 0;
  let playTurn = null;
  let bombs = 0;

  const farmers = () => [0, 1, 2].filter((s) => s !== landlord);

  return {
    seats: () => 3,
    phase: () => phase,
    seatLabel: (s) => (s === landlord ? "地主" : "农民"),
    pendingAction() {
      if (this.result()) return null;
      if (phase === "bid") {
        return { seat: bidTurn, kind: "bid", actions: ["bid:0", "bid:1", "bid:2", "bid:3"] };
      }
      const seat = playTurn ?? landlord;
      if (trick == null || trick.seat === seat) {
        // 自由出牌：任意非空牌型（清单给最小几组示意 + PASS 不允许）
        return { seat, kind: "play", actions: ["play:<任意合法牌型>"] };
      }
      const acts = ["play:PASS"];
      const resp = cheapestResponse(hands[seat], trick.type);
      if (resp) acts.push(`play:${resp.join("")}`);
      return { seat, kind: "play", actions: acts };
    },
    apply(seat, action) {
      if (this.result()) return { ok: false, reason: "对局已结束" };
      const s = String(action).trim();
      if (phase === "bid") {
        if (seat !== bidTurn) return { ok: false, reason: "还没轮到你叫牌" };
        const m = /^bid:([0-3])$/.exec(s);
        if (!m) return { ok: false, reason: '叫牌动作格式："bid:0"（不叫）到 "bid:3"' };
        const score = Number(m[1]);
        if (score > 0 && score <= bidScore) return { ok: false, reason: `必须高于当前最高叫分 ${bidScore}，或不叫 bid:0` };
        bids.push({ seat, score });
        if (score > bidScore) { bidScore = score; landlord = seat; }
        const bidders = bids.length;
        if (score === 3 || bidders === 3) {
          if (bidScore === 0) {
            if (redeals >= 3) { landlord = firstBid; bidScore = 1; } // 防死循环：强制成局
            else { redeals += 1; deal(); bids.length = 0; bidTurn = (firstBid + redeals) % 3; landlord = null; bidScore = 0; return { ok: true, events: [{ t: "redeal", count: redeals }] }; }
          }
          phase = "play";
          hands[landlord] = sortCards([...hands[landlord], ...bottom]);
          playTurn = landlord;
          return { ok: true, events: [{ t: "landlord", seat: landlord, bidScore, bottom: [...bottom] }] };
        }
        bidTurn = (bidTurn + 1) % 3;
        return { ok: true, events: [{ t: "bid", seat, score }] };
      }
      // 出牌阶段
      const turn = playTurn ?? landlord;
      if (seat !== turn) return { ok: false, reason: "还没轮到你出牌" };
      if (s === "play:PASS" || s === "PASS") {
        if (trick == null || trick.seat === seat) return { ok: false, reason: "本轮由你先出，不能 PASS" };
        plays.push({ seat, cards: [], pass: true });
        passes += 1;
        if (passes >= 2) { // 两家不要 → 领出权回到上一手出牌者
          playTurn = trick.seat;
          trick = null;
          passes = 0;
          return { ok: true, events: [{ t: "pass", seat }, { t: "lead", seat: playTurn }] };
        }
        playTurn = (seat + 1) % 3;
        return { ok: true, events: [{ t: "pass", seat }] };
      }
      const m = /^play:(.+)$/.exec(s);
      if (!m) return { ok: false, reason: '出牌动作格式："play:34567" 或 "play:PASS"' };
      const cards = normalizeCards(m[1]);
      if (!cards) return { ok: false, reason: "牌串含非法字符（合法：3-9/10/J/Q/K/A/2/X/D）" };
      const type = parseType(cards);
      if (!type) return { ok: false, reason: `${cardsText(cards)} 不是合法牌型` };
      if (trick && trick.seat !== seat && !beats(type, trick.type)) {
        return { ok: false, reason: `${cardsText(cards)}（${TYPE_ZH[type.type]}）压不过场上的 ${cardsText(trick.cards)}（${TYPE_ZH[trick.type.type]}）` };
      }
      // 手里真有这些牌吗
      const need = new Map();
      for (const c of cards) need.set(c, (need.get(c) ?? 0) + 1);
      const have = new Map();
      for (const c of hands[seat]) have.set(c, (have.get(c) ?? 0) + 1);
      for (const [c, k] of need) if ((have.get(c) ?? 0) < k) return { ok: false, reason: `你没有这些牌：${cardsText(cards)}` };
      hands[seat] = hands[seat].filter((c) => { const k = need.get(c) ?? 0; if (k > 0) { need.set(c, k - 1); return false; } return true; });
      plays.push({ seat, cards: sortCards(cards), won: hands[seat].length === 0 });
      if (type.type === "bomb" || type.type === "rocket") bombs += 1;
      trick = { seat, cards: sortCards(cards), type };
      passes = 0;
      if (hands[seat].length === 0) return { ok: true, events: [{ t: "play", seat, cards: sortCards(cards), done: true }] };
      playTurn = (seat + 1) % 3;
      return { ok: true, events: [{ t: "play", seat, cards: sortCards(cards), left: hands[seat].length }] };
    },
    result() {
      if (phase !== "play") return null;
      const done = plays.find((p) => p.won);
      if (!done) return null;
      const lordWin = done.seat === landlord;
      const farmersPlayed = farmers().map((f) => plays.filter((p) => p.seat === f && !p.pass).length);
      const lordPlayed = plays.filter((p) => p.seat === landlord && !p.pass).length;
      let mult = 2 ** bombs;
      if (lordWin && farmersPlayed.every((n) => n === 0)) mult *= 2; // 春天
      if (!lordWin && lordPlayed <= 1) mult *= 2; // 反春天
      const unit = bidScore * mult;
      const scores = [0, 0, 0];
      scores[landlord] = lordWin ? 2 * unit : -2 * unit;
      for (const f of farmers()) scores[f] = lordWin ? -unit : unit;
      // ranks = 每座位名次（seat → 名次值；赢队并列 0——storage/TureSkill 口径）
      const ranks = [0, 1, 2].map((s2) => ((s2 === landlord) === lordWin ? 0 : 1));
      return {
        over: true,
        winner: lordWin ? "landlord" : "farmer",
        teams: [[landlord], farmers()],
        rankNums: lordWin ? [0, 1] : [1, 0],
        ranks,
        scores,
        summary: `${lordWin ? "地主" : "农民"}胜（叫分 ${bidScore} × 倍数 ${mult}）；春天判定：${lordWin && farmersPlayed.every((n) => n === 0) ? "是" : !lordWin && lordPlayed <= 1 ? "反春" : "无"}`,
      };
    },
    viewFor(seat) {
      if (phase === "bid") {
        return [
          "【斗地主 · 叫牌阶段】3 人 2v1：地主 1 vs 农民 2（农民配合对抗地主）。叫分越高当地主，底分=叫分。",
          `你的手牌（${hands[seat].length} 张）：${cardsText(hands[seat])}`,
          bids.length ? `叫牌记录：${bids.map((b) => `${b.seat === seat ? "你" : `${b.seat + 1}号位`} ${b.score === 0 ? "不叫" : `${b.score} 分`}`).join("，")}` : "你是首个叫牌者。",
          bidScore > 0 ? `当前最高叫分 ${bidScore}。` : "",
          "轮到你叫牌。可选：bid:0（不叫）/ bid:1 / bid:2 / bid:3。",
          '输出格式：{"move":"bid:2","comment":"一句话思路"}',
        ].filter(Boolean).join("\n");
      }
      const isLord = seat === landlord;
      const mate = !isLord ? farmers().find((f) => f !== seat) : null;
      const hist = plays.map((p) => `${p.seat === seat ? "你" : p.seat === landlord ? "地主" : p.seat === mate ? "队友" : `${p.seat + 1}号位`} ${p.pass ? "不要" : cardsText(p.cards)}`).join("；");
      const lordLeft = hands[landlord].length;
      const team = isLord
        ? `你是地主。两个农民剩牌：${farmers().map((f) => `${f + 1}号位 ${hands[f].length} 张`).join("，")}。`
        : `你是农民（与 ${mate}号位 队友配合对抗地主）。合作提示：让队友的小牌先走、帮队友接风、留意地主剩牌数。地主剩 ${lordLeft} 张，队友剩 ${hands[mate].length} 张。`;
      const follow = trick && trick.seat !== seat
        ? `场上的牌（${trick.seat === seat ? "你" : trick.seat === landlord ? "地主" : trick.seat === mate ? "队友" : `${trick.seat + 1}号位`} 出的 ${TYPE_ZH[trick.type.type]} ${cardsText(trick.cards)}）：你需要出更大的同型牌，压不起就 play:PASS。`
        : "本轮由你先出（任意合法牌型）。";
      return [
        `【斗地主 · 出牌阶段】${team}`,
        `你的手牌（${hands[seat].length} 张）：${cardsText(hands[seat])}`,
        `明牌（底牌，归地主）：${cardsText(bottom)}`,
        `出牌记录：${hist || "（你先出）"}`,
        follow,
        '出牌格式："play:3334"（三带一）、"play:34567"（顺子）、"play:PASS"。牌面字符：3-9/10(可写T)/J/Q/K/A/2/X小王/D大王。',
        '输出格式：{"move":"play:...","comment":"一句话思路/垃圾话"}',
      ].join("\n");
    },
    suggestAction(seat) {
      if (phase === "bid") return "bid:0"; // 保守代走：不叫
      if (trick && trick.seat !== seat) {
        const resp = cheapestResponse(hands[seat], trick.type);
        return resp ? `play:${resp.join("")}` : "play:PASS";
      }
      // 领出：最小单张（有对/顺就出？简化：最小单）
      const hand = sortCards(hands[seat]);
      return `play:${hand[0]}`;
    },
    getState: () => ({
      phase, landlord, bidScore, bottom: [...bottom],
      hands: hands.map((h) => [...h]),
      plays: plays.map((p) => ({ ...p, cards: [...(p.cards ?? [])] })),
      trick: trick ? { ...trick, cards: [...trick.cards] } : null,
      bombs, redeals,
    }),
  };
}

registerGame({
  id: "doudizhu",
  label: "斗地主",
  short: "斗地主",
  desc: "3 人 2v1，叫分定地主，农民合作对抗",
  order: 3,
  cat: "cards",
  color: "#4f8cff",
  boardKind: "cards",
  seats: 3,
  minSeats: 3,
  createGame: createDoudizhuGame,
});
