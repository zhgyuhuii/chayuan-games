/**
 * 日麻立直麻将裁判（games-llm-arena-games2 Q1/Q7）：136 张（万筒索+字）+宝牌，
 * 立直/振听/门前清自摸/役种起和；中度辅助 viewFor（听牌清单+振听+宝牌+风位
 * 实时标注，役候选/推荐打牌不喂）；振听荣和不进合法动作清单（引擎真值口径）。
 *
 * 收割裁定（2026-11-06）：原计划 npm 收割 mahjong-utils 算番——本环境 npm
 * 注册表不可达（tenuki spike 同因），牌理复用推倒胡 34 维模块、算番自写。
 *
 * 简化口径（对局摘要声明，评审可砍）：
 *  - 役种表（可叠）：立直1 门前自摸1 平和1 断幺九1 役牌(场风/自风/三元)各1
 *    一杯口1 七对子2 对对和2 三色同顺2 一气通贯2 混一色3 清一色6；
 *    无役不能胡（起和 1 番）；国士/绿一色/大牌类砍；
 *  - 不算符：点数 = 300 × 2^min(fan,4)（300/600/1200/2400，4 番封顶=跳满砍）；
 *    荣和点炮者付全额；自摸其余三家各付一半（取整百）——名次排序够用口径；
 *  - 宝牌：表宝 1 枚（指示牌下一张：数牌同花色 n+1，字牌 E→S→W→N→E、
 *    C→F→B→C），每宝 +1 番；无红宝（136 张无赤）；
 *  - 立直：门前听牌宣告，不供点（纯状态锁）、立直后只能摸切、不能杠；
 *    立直振听/双立直砍；
 *  - 振听（简化=同种永久）：自己牌河里有的待牌不能荣和；振听荣和不进清单；
 *  - 一炮多响不收；流局不查听不计分（draw 并列）；庄家固定 seat0、连庄砍；
 *    海底/河底/杠宝/里宝砍。
 *
 * 牌串与推倒胡同：数牌 "5m"，字牌大写 E/S/W/N/C(中)/F(发)/B(白)。
 * 动作：discard:5m / action:pass|pon|kan|chi:<顺子最小牌>|hora（荣和）/
 *       自摸轮 action:riichi / action:ankan:2s / action:kakan:2s / action:hora（自摸）。
 */
import { registerGame } from "../registry.js";
import { tileIdx, idxTile, tileZh, sortTiles, fullWall, countsOf, isWinHand, waitTiles, HONORS } from "./mahjong-guangdong.js";

const N_KINDS = 34;
const WINDS = ["E", "S", "W", "N"]; // 座位 0-3 自风（场风固定东）
/** 表宝指示牌 → 宝牌。 */
export function doraOf(indicator) {
  const i = tileIdx(indicator);
  if (i >= 27) {
    // 字牌轮转 E→S→W→N→E；C→F→B→C
    const order = i < 31 ? ["E", "S", "W", "N"] : ["C", "F", "B"];
    const arr = i < 31 ? WINDS : ["C", "F", "B"];
    void order;
    return arr[(arr.indexOf(indicator) + 1) % arr.length];
  }
  const suit0 = Math.floor(i / 9) * 9;
  return idxTile(suit0 + (i % 9 === 8 ? 0 : (i % 9) + 1)); // 9→1 环绕
}

/** 手牌（含副露）是否幺九相关：含任意字牌或 1/9 数牌。 */
function hasTerminalsOrHonors(tiles) {
  return tiles.some((t) => HONORS.includes(t) || t[0] === "1" || t[0] === "9");
}

/** 七对子判定（7 对互不相同=龙七对不收额外）。 */
export function isChiitoi(tiles) {
  if (tiles.length !== 14) return false;
  const c = countsOf(tiles);
  let pairs = 0;
  for (let i = 0; i < N_KINDS; i += 1) { if (c[i] === 2) pairs += 1; else if (c[i] !== 0) return false; }
  return pairs === 7;
}

/** 平和判定（简化：全部顺子+非役牌雀头，无副露）——对 14 张听牌型手。 */
function isPinfu(concealed, pairTile, meldCount) {
  if (meldCount > 0) return false;
  const c = countsOf(concealed);
  c[tileIdx(pairTile)] -= 2;
  // 剩余须全顺子：贪心拆
  for (let i = 0; i < 27; i += 1) {
    if (c[i] > 0) {
      if (i % 9 > 6 || c[i + 1] <= 0 || c[i + 2] <= 0) return false;
      c[i] -= 1; c[i + 1] -= 1; c[i + 2] -= 1;
      i -= 1; // 同起点可能多套
    }
  }
  // 雀头非役牌（场风东/自风/三元）
  return !["E", "C", "F", "B"].includes(pairTile);
}

/** 一杯口（同顺子两套）。 */
function hasIipeikou(concealed, meldCount) {
  if (meldCount > 0) return false;
  const c = countsOf(concealed);
  for (let i = 0; i < 27; i += 1) {
    if (i % 9 <= 6 && c[i] >= 2 && c[i + 1] >= 2 && c[i + 2] >= 2) return true;
  }
  return false;
}

/** 三色同顺 / 一气通贯（含副露顺子，简化：只看全牌 34 计数的顺子含量）。 */
function meldRunsOf(concealed, melds) {
  const c = countsOf(concealed);
  const add = (t) => { c[tileIdx(t)] += 1; };
  for (const m of melds) {
    if (m.type === "chi") m.tiles.forEach(add);
    else for (let k = 0; k < 3; k += 1) add(m.tile);
  }
  // 拆对子后剩余全按面子算（近似：不给精确分解——三色/一气用存在性判定）
  const runs = [];
  for (let i = 0; i < 27; i += 1) {
    if (i % 9 <= 6) {
      let n = 0;
      while (c[i] > 0 && c[i + 1] > 0 && c[i + 2] > 0) { c[i] -= 1; c[i + 1] -= 1; c[i + 2] -= 1; n += 1; }
      if (n) runs.push([i, n]);
    }
  }
  return runs;
}

/** 役种评估：concealed 14 张（或 13+win），melds 副露，返回 { fan, yaku:[名] }。 */
export function evalYaku(concealed, melds, { riichi = false, selfDraw = false, seat = 0, winTile = null, dora = [] } = {}) {
  const yaku = [];
  const all = [...concealed, ...melds.flatMap((m) => (m.type === "chi" ? m.tiles : [m.tile, m.tile, m.tile].concat(m.type === "pon" ? [] : [m.tile])))];
  const meldCount = melds.length;
  const concealedOnly = concealed;
  if (riichi) yaku.push(["立直", 1]);
  if (selfDraw && meldCount === 0) yaku.push(["门前清自摸和", 1]);
  // 役牌（刻子）
  const c = countsOf(all);
  const yakuhai = [];
  for (const t of ["E", "C", "F", "B"]) {
    if (c[tileIdx(t)] >= 3) { yakuhai.push(t === "E" ? "场风牌东" : t === WINDS[seat] ? `自风牌${tileZh(t)}` : tileZh(t)); yaku.push([`役牌·${tileZh(t)}`, 1]); }
  }
  void yakuhai;
  if (isChiitoi(concealedOnly) && meldCount === 0) yaku.push(["七对子", 2]);
  else {
    // 雀头枚举用于平和
    const cc = countsOf(concealedOnly);
    let pinfu = false;
    let iipeikou = false;
    let toitoi = melds.every((m) => m.type !== "chi");
    if (meldCount === 0) {
      for (let i = 0; i < N_KINDS; i += 1) {
        if (cc[i] >= 2) {
          cc[i] -= 2;
          const rest = concealedOnly.filter((_, k) => k >= 0); // 近似：用计数法判全顺
          void rest;
          cc[i] += 2;
        }
      }
      // 简化：平和由 isPinfu 单独判（枚举雀头在外面做）
      pinfu = false;
      iipeikou = hasIipeikou(concealedOnly, 0);
    }
    void pinfu;
    if (iipeikou) yaku.push(["一杯口", 1]);
    if (toitoi) {
      // 手牌部分全刻+对（近似判：对对和=副露无吃+手牌可拆全刻）
      const c2 = countsOf(concealedOnly);
      let pairFound = false;
      let okToitoi = false;
      for (let i = 0; i < N_KINDS; i += 1) {
        if (c2[i] >= 2) {
          c2[i] -= 2;
          let allT = true;
          for (let k = 0; k < N_KINDS; k += 1) if (c2[k] !== 0 && c2[k] !== 3) { allT = false; break; }
          c2[i] += 2;
          if (allT) { pairFound = true; okToitoi = true; break; }
        }
      }
      void pairFound;
      if (okToitoi) yaku.push(["对对和", 2]);
    }
  }
  if (!hasTerminalsOrHonors(all) && all.length === 14) yaku.push(["断幺九", 1]);
  // 清一色/混一色
  const suitSet = new Set(all.filter((t) => !HONORS.includes(t)).map((t) => t[1]));
  const honorN = all.filter((t) => HONORS.includes(t)).length;
  if (suitSet.size === 1 && honorN === 0) yaku.push(["清一色", 6]);
  else if (suitSet.size === 1 && honorN > 0) yaku.push(["混一色", 3]);
  // 三色同顺 / 一气通贯（runs 存在性）
  const runs = meldRunsOf(concealedOnly, melds);
  const suitOfIdx = (i) => Math.floor(i / 9);
  for (const [i, n] of runs) {
    if (suitOfIdx(i) === 0) {
      const b = runs.find(([x]) => x === i + 9);
      const cc2 = runs.find(([x]) => x === i + 18);
      if (b && cc2) { yaku.push(["三色同顺", 2]); break; }
    }
  }
  for (const [i, n] of runs) {
    if (i % 9 === 0 && n >= 1) {
      const m2 = runs.find(([x]) => x === i + 1);
      const m3 = runs.find(([x]) => x === i + 2);
      if (m2 && m3 && suitOfIdx(i) === suitOfIdx(i + 2)) { yaku.push(["一气通贯", 2]); break; }
    }
  }
  // 平和（雀头枚举）
  if (meldCount === 0 && !yaku.some(([n]) => n.startsWith("役牌") || n === "对对和" || n === "七对子")) {
    const c3 = countsOf(concealedOnly);
    for (let i = 0; i < N_KINDS; i += 1) {
      if (c3[i] >= 2) {
        const tiles = [...concealedOnly];
        const idxFirst = tiles.findIndex((t) => tileIdx(t) === i);
        tiles.splice(idxFirst, 1);
        tiles.splice(tiles.findIndex((t) => tileIdx(t) === i), 1);
        if (isPinfu(tiles, idxTile(i), 0)) { yaku.push(["平和", 1]); break; }
      }
    }
  }
  // 宝牌
  const doraCount = all.filter((t) => dora.includes(t)).length + (winTile && dora.includes(winTile) ? 0 : 0);
  if (doraCount > 0) yaku.push([`宝牌×${doraCount}`, doraCount]);
  const fan = yaku.reduce((s, [, f]) => s + f, 0);
  return { fan, yaku: yaku.map(([n]) => n), points: 300 * 2 ** Math.min(fan, 4) };
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

export function createRiichiGame({ seed = Date.now() % 2 ** 31 } = {}) {
  const rng = mulberry32(seed);
  const wall = fullWall();
  for (let i = wall.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const hands = [[], [], [], []];
  for (let s = 0; s < 4; s += 1) hands[s] = sortTiles(wall.splice(0, 13));
  const discards = [[], [], [], []];
  const melds = [[], [], [], []];
  const riichi = [false, false, false, false];
  const scores = [0, 0, 0, 0];
  const indicator = wall.splice(Math.floor(wall.length / 2), 1)[0] ?? "1m"; // 表宝指示（简化：牌墙中位抽 1）
  const dora = [doraOf(indicator)];
  let turn = 0;
  let drawn = null;
  let claimCtx = null;
  let events = [];
  let ended = null;

  const draw = () => (wall.length ? wall.pop() : null);
  // 庄家进第一摸（开局即补第 14 张）
  {
    const t0 = draw();
    if (!t0) ended = { over: true, ranks: [0, 0, 0, 0], scores: [...scores], draw: true, summary: "流局（异常空墙）" };
    else { hands[0] = sortTiles([...hands[0], t0]); drawn = t0; events = [{ t: "draw", seat: 0, tile: t0 }]; }
  }
  const concealed = (seat) => hands[seat];

  /** seat 振听待牌集合（自己牌河有过的听牌——同种永久，简化口径）。 */
  const furhaTiles = (seat) => new Set(discards[seat]);

  /** seat 对 tile 的荣和资格：胡牌型 + 有役（简化：立直或役牌或断幺等由
   *  evalYaku 复核）+ 不振听。 */
  const canRon = (seat, tile, from) => {
    if (riichi[seat]) {
      // 立直家：只需胡牌型+不现物振听（立直后不能改听，同种永久口径）
      if (discards[seat].includes(tile)) return false;
      return isWinHand([...hands[seat], tile]);
    }
    if (furhaTiles(seat).has(tile)) return false; // 同种振听
    if (!isWinHand([...hands[seat], tile])) return false;
    const { fan } = evalYaku([...hands[seat], tile], melds[seat], { riichi: riichi[seat], selfDraw: false, seat, winTile: tile, dora });
    return fan >= 1; // 无役不荣
  };
  const canPon = (seat, tile) => hands[seat].filter((t) => t === tile).length >= 2 && !riichi[seat];
  const canKan = (seat, tile) => hands[seat].filter((t) => t === tile).length >= 3 && !riichi[seat];
  const chiLows = (seat, tile) => {
    if (HONORS.includes(tile) || riichi[seat]) return [];
    const idx = tileIdx(tile);
    const suit0 = Math.floor(idx / 9) * 9;
    const c = countsOf(hands[seat]);
    const out = [];
    for (let low = idx - 2; low <= idx; low += 1) {
      if (low < suit0 || low % 9 > 6) continue;
      const need = [low, low + 1, low + 2].filter((x) => x !== idx);
      if (need.every((x) => c[x] > 0)) out.push(idxTile(low));
    }
    return out;
  };
  const canTsumo = (seat) => isWinHand(hands[seat]) && evalYaku(hands[seat], melds[seat], { riichi: riichi[seat], selfDraw: true, seat, dora }).fan >= 1;

  const openClaims = (from, tile) => {
    const cands = [];
    for (let k = 1; k <= 3; k += 1) {
      const s = (from + k) % 4;
      const allows = [];
      if (canRon(s, tile, from)) allows.push("action:hora");
      if (canKan(s, tile)) allows.push("action:kan");
      if (canPon(s, tile)) allows.push("action:pon");
      if (k === 1) for (const low of chiLows(s, tile)) allows.push(`action:chi:${low}`);
      if (allows.length) cands.push({ seat: s, allows });
    }
    cands.sort((a, b) => (b.allows.includes("action:hora") ? 1 : 0) - (a.allows.includes("action:hora") ? 1 : 0));
    if (cands.length) claimCtx = { tile, from, candidates: cands, idx: 0 };
    else advanceTurn(from);
  };

  const advanceTurn = (from) => {
    if (ended) return;
    turn = (from + 1) % 4;
    const t = draw();
    if (!t) { finishRyuukyoku(); return; }
    hands[turn] = sortTiles([...hands[turn], t]);
    drawn = t;
    events = [...events, { t: "draw", seat: turn, tile: t }];
  };

  const finishRyuukyoku = () => {
    ended = { over: true, ranks: [0, 0, 0, 0], scores: [...scores], draw: true, summary: "流局（荒牌，不查听不计分——简化口径）：四家并列" };
  };

  const finishHora = (seat, why) => {
    const others = [0, 1, 2, 3].filter((s) => s !== seat).sort((a, b) => scores[b] - scores[a]);
    const ranks = new Array(4).fill(0);
    others.forEach((s, i) => { ranks[s] = i + 1 > 1 && scores[s] === scores[others[i - 1]] ? ranks[others[i - 1]] : i + 1; });
    ended = { over: true, ranks, scores: [...scores], draw: false, summary: why };
  };

  const removeTiles = (seat, list) => {
    const rm = [...list];
    hands[seat] = hands[seat].filter((t) => { if (rm.includes(t)) { rm.splice(rm.indexOf(t), 1); return false; } return true; });
  };

  return {
    seats: () => 4,
    phase: () => (ended ? "over" : claimCtx ? "claim" : "play"),
    seatLabel: (s) => `${tileZh(WINDS[s])}家`,
    wallLeft: () => wall.length,
    pendingAction() {
      if (ended) return null;
      if (claimCtx) {
        const cand = claimCtx.candidates[claimCtx.idx];
        return { seat: cand.seat, kind: "claim", actions: ["action:pass", ...cand.allows] };
      }
      const acts = riichi[turn]
        ? (canTsumo(turn) ? ["action:hora"] : []).concat([`discard:${drawn}`]) // 立直锁：只能摸切（或自摸）
        : hands[turn].map((t) => `discard:${t}`);
      if (drawn && !riichi[turn]) {
        if (canTsumo(turn)) acts.push("action:hora");
        // 立直宣告：门前+听牌（含刚摸）
        if (melds[turn].length === 0) {
          for (const t of new Set(hands[turn])) {
            const rest = [...hands[turn]];
            rest.splice(rest.indexOf(t), 1);
            if (waitTiles(rest).length > 0) { acts.push("action:riichi"); break; }
          }
        }
        const c = countsOf(hands[turn]);
        for (let i = 0; i < N_KINDS; i += 1) if (c[i] === 4) acts.push(`action:ankan:${idxTile(i)}`);
        for (const m of melds[turn]) if (m.type === "pon" && hands[turn].includes(m.tile)) acts.push(`action:kakan:${m.tile}`);
      }
      return { seat: turn, kind: drawn ? "self" : "discard", actions: acts };
    },
    apply(seat, action) {
      if (ended) return { ok: false, reason: "对局已结束" };
      const pending = this.pendingAction();
      if (!pending) return { ok: false, reason: "当前无可执行动作" };
      if (pending.seat !== seat) return { ok: false, reason: "还没轮到你" };
      const s = String(action).trim();
      if (claimCtx) {
        const cand = claimCtx.candidates[claimCtx.idx];
        if (s === "action:pass") {
          claimCtx.idx += 1;
          const ev = [{ t: "pass", seat }];
          if (claimCtx.idx >= claimCtx.candidates.length) { const { from } = claimCtx; claimCtx = null; advanceTurn(from); }
          return { ok: true, events: ev };
        }
        if (s === "action:hora" && cand.allows.includes("action:hora")) {
          const { tile, from } = claimCtx;
          hands[seat] = [...hands[seat], tile];
          const { fan, yaku, points } = evalYaku(hands[seat], melds[seat], { riichi: riichi[seat], selfDraw: false, seat, winTile: tile, dora });
          scores[seat] += points; scores[from] -= points;
          claimCtx = null;
          const ev = [{ t: "hora", seat, from, tile, fan, yaku }];
          events = [...events, ...ev];
          finishHora(seat, `${tileZh(WINDS[seat])}家(${seat + 1}号) 荣和 ${seat === from ? "" : `${from + 1}号`}的 ${tileZh(tile)}：${fan} 番（${yaku.join("、")}）${points} 点`);
          return { ok: true, events: ev };
        }
        if (s === "action:pon" && cand.allows.includes("action:pon")) {
          const { tile, from } = claimCtx;
          removeTiles(seat, [tile, tile]);
          melds[seat] = [...melds[seat], { type: "pon", tile, from }];
          claimCtx = null;
          turn = seat; drawn = null;
          events = [...events, { t: "pon", seat, from, tile }];
          return { ok: true, events: [{ t: "pon", seat, from, tile }] };
        }
        if (s === "action:kan" && cand.allows.includes("action:kan")) {
          const { tile, from } = claimCtx;
          removeTiles(seat, [tile, tile, tile]);
          melds[seat] = [...melds[seat], { type: "kan", tile, from }];
          claimCtx = null;
          events = [...events, { t: "kan", seat, from, tile }];
          turn = seat;
          const t = draw();
          if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "kan", seat, from, tile }] }; }
          hands[seat] = sortTiles([...hands[seat], t]);
          drawn = t;
          events = [...events, { t: "draw", seat, tile: t }];
          return { ok: true, events: [{ t: "kan", seat, from, tile }] };
        }
        const chi = /^action:chi:(.+)$/.exec(s);
        if (chi && cand.allows.includes(s)) {
          const { tile, from } = claimCtx;
          const low = chi[1];
          const run = [low, idxTile(tileIdx(low) + 1), idxTile(tileIdx(low) + 2)];
          removeTiles(seat, run.filter((t) => t !== tile));
          melds[seat] = [...melds[seat], { type: "chi", tiles: run, from }];
          claimCtx = null;
          turn = seat; drawn = null;
          events = [...events, { t: "chi", seat, from, tile, run }];
          return { ok: true, events: [{ t: "chi", seat, from, tile, run }] };
        }
        return { ok: false, reason: `表态动作不在清单里（你可用的：${["action:pass", ...cand.allows].join(" ")}）` };
      }
      // 自摸轮
      if (s === "action:riichi") {
        if (!drawn || melds[seat].length > 0) return { ok: false, reason: "立直需要门前清且刚摸牌" };
        let tenpai = false;
        for (const t of new Set(hands[seat])) {
          const rest = [...hands[seat]];
          rest.splice(rest.indexOf(t), 1);
          if (waitTiles(rest).length > 0) { tenpai = true; break; }
        }
        if (!tenpai) return { ok: false, reason: "立直必须听牌（你当前未听）" };
        riichi[seat] = true;
        events = [...events, { t: "riichi", seat }];
        return { ok: true, events: [{ t: "riichi", seat }] };
      }
      if (s === "action:hora" || s.startsWith("action:hora")) {
        if (!canTsumo(seat)) return { ok: false, reason: "不能自摸：手牌不成胡型或无役（≥1 番起和）" };
        const { fan, yaku, points } = evalYaku(hands[seat], melds[seat], { riichi: riichi[seat], selfDraw: true, seat, dora });
        const each = Math.ceil(points / 2 / 100) * 100;
        for (let o = 0; o < 4; o += 1) if (o !== seat) { scores[o] -= each; scores[seat] += each; }
        const wonTile = drawn;
        drawn = null;
        const ev = [{ t: "hora", seat, from: -1, tile: wonTile, fan, yaku }];
        events = [...events, ...ev];
        finishHora(seat, `${tileZh(WINDS[seat])}家(${seat + 1}号) 自摸 ${wonTile ? tileZh(wonTile) : ""}：${fan} 番（${yaku.join("、")}）三家各付 ${each}`);
        return { ok: true, events: ev };
      }
      const ank = /^action:ankan:(.+)$/.exec(s);
      if (ank) {
        const tile = ank[1];
        if (!drawn || turn !== seat) return { ok: false, reason: "暗杠只能在刚摸牌后进行" };
        if (riichi[seat]) return { ok: false, reason: "立直后不能杠（简化口径）" };
        if (countsOf(hands[seat])[tileIdx(tile)] < 4) return { ok: false, reason: `你没有 4 张 ${tileZh(tile)}` };
        removeTiles(seat, [tile, tile, tile, tile]);
        melds[seat] = [...melds[seat], { type: "ankan", tile, from: seat }];
        events = [...events, { t: "ankan", seat, tile }];
        turn = seat;
        const t = draw();
        if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "ankan", seat, tile }] }; }
        hands[seat] = sortTiles([...hands[seat], t]);
        drawn = t;
        events = [...events, { t: "draw", seat, tile: t }];
        return { ok: true, events: [{ t: "ankan", seat, tile }] };
      }
      const kak = /^action:kakan:(.+)$/.exec(s);
      if (kak) {
        const tile = kak[1];
        if (!drawn || turn !== seat) return { ok: false, reason: "补杠只能在刚摸牌后进行" };
        if (riichi[seat]) return { ok: false, reason: "立直后不能杠（简化口径）" };
        if (!melds[seat].some((m) => m.type === "pon" && m.tile === tile) || !hands[seat].includes(tile)) {
          return { ok: false, reason: `补杠需要已有 ${tileZh(tile)} 的碰且摸到第 4 张` };
        }
        removeTiles(seat, [tile]);
        melds[seat] = [...melds[seat], { type: "kakan", tile, from: seat }];
        events = [...events, { t: "kakan", seat, tile }];
        turn = seat;
        const t = draw();
        if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "kakan", seat, tile }] }; }
        hands[seat] = sortTiles([...hands[seat], t]);
        drawn = t;
        events = [...events, { t: "draw", seat, tile: t }];
        return { ok: true, events: [{ t: "kakan", seat, tile }] };
      }
      const dm = /^discard:(.+)$/.exec(s);
      if (!dm) return { ok: false, reason: '动作格式："discard:5m" / "action:riichi" 立直 / "action:hora" 自摸 / "action:ankan:2s" / "action:kakan:2s"（荣和表态 "action:hora"）' };
      const tile = dm[1];
      if (!hands[seat].includes(tile)) return { ok: false, reason: `你没有 ${HONORS.includes(tile) ? tileZh(tile) : tile} 这张牌（字牌大写：E南?不——E东 S南 W西 N北 C中 F发 B白）` };
      if (riichi[seat] && tile !== drawn) return { ok: false, reason: `立直后只能打刚摸的 ${tileZh(drawn)}（摸切锁定）` };
      removeTiles(seat, [tile]);
      discards[seat] = [...discards[seat], tile];
      events = [...events, { t: "discard", seat, tile }];
      drawn = null;
      openClaims(seat, tile);
      return { ok: true, events: [{ t: "discard", seat, tile }] };
    },
    result: () => ended,
    viewFor(seat) {
      const handText = hands[seat].map((t) => tileZh(t)).join(" ");
      const meldText = (s) => melds[s].map((m) => ({ chi: "吃", pon: "碰", kan: "明杠", ankan: "暗杠", kakan: "补杠" }[m.type]) + (m.type === "chi" ? m.tiles.map(tileZh).join("") : tileZh(m.tile))).join("、") || "无";
      const riverText = (s) => discards[s].map((t) => tileZh(t)).join("") || "空";
      const waits = waitTiles(hands[seat]);
      const fur = waits.filter((w) => furhaTiles(seat).has(w));
      const recent = events.slice(-20).map((e) => {
        const who = (x) => (x === seat ? "你" : `${x + 1}号`);
        switch (e.t) {
          case "draw": return `${who(e.seat)}摸牌${e.seat === seat ? `（${tileZh(e.tile)}）` : ""}`;
          case "discard": return `${who(e.seat)}打 ${tileZh(e.tile)}`;
          case "pon": return `${who(e.seat)}碰 ${tileZh(e.tile)}`;
          case "kan": return `${who(e.seat)}明杠`;
          case "ankan": return `${who(e.seat)}暗杠`;
          case "kakan": return `${who(e.seat)}补杠`;
          case "chi": return `${who(e.seat)}吃 ${tileZh(e.tile)}`;
          case "riichi": return `${who(e.seat)}宣告立直！`;
          case "pass": return `${who(e.seat)}过`;
          default: return e.t;
        }
      }).join("；");
      const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => `${s + 1}号（${tileZh(WINDS[s])}家${riichi[s] ? "·立直" : ""}，${hands[s].length}张）：副露 ${meldText(s)}，牌河 ${riverText(s)}`).join("\n");
      const pend = this.pendingAction();
      return [
        `【日本立直麻将】136 张+宝牌，场风东、你是${tileZh(WINDS[seat])}家（${seat + 1} 号位）。宝牌指示牌：${tileZh(indicator)} → 宝牌=${tileZh(dora[0])}（每张+1 番）。番种（可叠）：立直1/门前自摸1/平和1/断幺1/役牌1/一杯口1/七对2/对对2/三色2/一气2/混一3/清一6；起和 1 番。点数=300×2^番（封顶4番2400）；荣和点炮者付、自摸三家各付半。流局不计分。振听：自己打过的待牌不能荣和（只能自摸）。`,
        `你的手牌（${hands[seat].length} 张）：${handText}`,
        riichi[seat] ? "你已立直：每巡自动只能打刚摸的牌（摸切），可自摸胡" : "",
        drawn && turn === seat && !claimCtx ? `你刚摸到：${tileZh(drawn)}` : "",
        waits.length ? `你已听牌，待牌：${waits.map((w) => tileZh(w)).join("、")}${fur.length ? `（其中振听：${fur.map((w) => tileZh(w)).join("、")}——自己打过，不能荣和，只能等自摸）` : ""}` : "",
        `其余三家：\n${others}`,
        `事件（最近）：${recent || "开局"}`,
        pend && pend.seat === seat ? `轮到你。可行动作：${pend.actions.join(" ")}` : "等待其他玩家…",
        '输出格式：{"move":"discard:5m","comment":"一句话思路"}（动作必须严格从清单选）',
      ].filter(Boolean).join("\n");
    },
    suggestAction(seat) {
      const pend = this.pendingAction();
      if (!pend) return null;
      if (pend.kind === "claim") {
        if (pend.actions.includes("action:hora")) return "action:hora";
        return "action:pass"; // 碰杠吃不表态（同血战口径）
      }
      if (pend.actions.includes("action:hora")) return "action:hora";
      if (pend.actions.includes("action:riichi") && Math.random() < 0.5) return "action:riichi"; // 能立直且听牌 → 半数宣告（保守代走）
      if (riichi[seat]) return `discard:${drawn}`; // 立直摸切
      const hand = hands[seat];
      for (const t of new Set(hand)) {
        const rest = [...hand]; rest.splice(rest.indexOf(t), 1);
        if (waitTiles(rest).length > 0) return `discard:${t}`;
      }
      // 最孤张（字牌单张最先丢）
      const worst = [...new Set(hand)].sort((a, b) => {
        const w = (t) => (HONORS.includes(t) ? (countsOf(hand)[tileIdx(t)] >= 2 ? 2 : 0) : 1);
        return w(a) - w(b);
      })[0];
      return `discard:${worst}`;
    },
    getState() {
      return {
        phase: this.phase(), wall: wall.length,
        hands: hands.map((h) => [...h]), melds: melds.map((m) => [...m]),
        discards: discards.map((d) => [...d]), riichi: [...riichi], scores: [...scores],
        doraIndicator: indicator, dora: [...dora], winds: [...WINDS],
        alive: [true, true, true, true], won: [false, false, false, false], lacks: [null, null, null, null],
        turn, drawn,
      };
    },
    exportEvents: () => [...events],
  };
}

registerGame({
  id: "mahjong-riichi",
  label: "日本立直麻将",
  short: "立直麻将",
  desc: "136 张+宝牌，立直/振听/役种起和，点数制",
  order: 10,
  cat: "mahjong",
  hidden: true, // 2026-11-07 用户裁定：大厅隐藏（引擎/回放保留）
  color: "#8a5fb0",
  boardKind: "mahjong",
  seats: 4,
  minSeats: 4,
  createGame: createRiichiGame,
});
