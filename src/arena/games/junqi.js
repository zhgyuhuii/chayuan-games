/**
 * 两人暗棋军棋（陆战棋）裁判（games-llm-arena-games2 Q2/Q6）：
 * 布阵（25 子、约束校验、非法带明细回喂 ≤3 次 → 模板阵库代摆不计代走）+
 * 行棋（铁路直线滑行/工兵铁路转弯/行营 8 向安全区/大本营入内锁死）+
 * 暗棋碰撞裁决（大小吃/同级兑/炸弹同尽/工兵挖雷/扛旗终局，翻尸亮明）。
 * 信息隐藏由 viewFor(seat) 天然承担：只见对方暗子位置、不见身份；碰撞
 * 结果由裁判回喂（luzhanqi-judger/kriegspiel 只参考规则流程，代码零搬运）。
 *
 * 棋盘口径（12×5，对局摘要声明；拓扑=标准陆战棋，无中间山界）：
 *  - 行 1-6 为上方（seat 1）阵地、行 7-12 为下方（seat 0），A1=左上角；
 *  - 行营（安全区，8 向连通、不可被攻击）：上方 B2/D2/C3/B4/D4，下方
 *    B9/D9/C10/B11/D11（字母=列 A-E，数字=行 1-12）；
 *  - 大本营（入内锁死）：上方 B1/D1，下方 B12/D12；
 *  - 铁路：A/F 两条竖线（A 列、E 列全 12 行）+ 第 2/11 行两条横线；铁路
 *    直线滑行任意远（不可越子），工兵可在铁路网内任意转弯（BFS 路径全空）。
 *
 * 子力（各 25）：司令×1 军长×1 师长×2 旅长×2 团长×2 营长×2 连长×3 排长×3
 * 工兵×3 地雷×3 炸弹×2 军旗×1。地雷/军旗不可移动。
 * 裁决：大吃小；同级同归于尽；炸弹与任何子同归于尽；地雷只被工兵挖（其余
 * 撞雷者亡）；攻入敌方大本营扛旗即胜。司令阵亡 → 军旗对敌亮明（正统规则）。
 *
 * 布阵约束（Q6）：25 子恰好填满本方 25 个可摆位（行营除外）；军旗进大本营；
 * 地雷只摆本方后两排；炸弹不进本方第一排。
 * 动作：布阵 "setup:司,军,师,…25 项"（按可摆位从左到右、从上到下）；
 *       行棋 "move:A4-A5"；认输由 MatchRunner 处理。
 */
import { registerGame } from "../registry.js";

const COLS = "ABCDE";
const N_ROWS = 12;
const PIECE_ZH = { siling: "司令", junzhang: "军长", shizhang: "师长", lvzhang: "旅长", tuanzhang: "团长", yingzhang: "营长", lianzhang: "连长", paizhang: "排长", gongbing: "工兵", dilei: "地雷", zhadan: "炸弹", junqi: "军旗" };
const ZH_PIECE = Object.fromEntries(Object.entries(PIECE_ZH).map(([k, v]) => [v, k]));
export const RANK = { "司令": 9, "军长": 8, "师长": 7, "旅长": 6, "团长": 5, "营长": 4, "连长": 3, "排长": 2, "工兵": 1 };
export const VALUE = { "司令": 40, "军长": 30, "师长": 25, "旅长": 20, "团长": 16, "营长": 12, "连长": 9, "排长": 7, "工兵": 12, "地雷": 18, "炸弹": 22, "军旗": 60 };
/** 各方 25 子的规范多重集（setup 校验基准）。 */
export const FULL_SET = ["司令", "军长", "师长", "师长", "旅长", "旅长", "团长", "团长", "营长", "营长", "连长", "连长", "连长", "排长", "排长", "排长", "工兵", "工兵", "工兵", "地雷", "地雷", "地雷", "炸弹", "炸弹", "军旗"];

/** 行营（seat 0 下方 / seat 1 上方；坐标 0 起算）。 */
export const CAMPS = [
  [[10, 1], [10, 3], [9, 2], [8, 1], [8, 3]], // seat 0（行 11/9/10 1 起算 = B11/D11/C10/B9/D9）
  [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]], // seat 1（B2/D2/C3/B4/D4）
];
/** 大本营（各方后排两个，180° 对称：下方 B12/D12，上方 B1/D1）。 */
export const HQ = [[[11, 1], [11, 3]], [[0, 1], [0, 3]]];
/** 铁路格：A/E 全列 + 第 2/11 行。 */
export function isRail(r, c) {
  return c === 0 || c === 4 || r === 1 || r === 10;
}
const isCamp = (r, c) => CAMPS.some((side) => side.some(([rr, cc]) => rr === r && cc === c));
const campOfSeat = (seat, r, c) => CAMPS[seat].some(([rr, cc]) => rr === r && cc === c);
const isHq = (r, c) => HQ.some((side) => side.some(([rr, cc]) => rr === r && cc === c));
const hqOfSeat = (seat, r, c) => HQ[seat].some(([rr, cc]) => rr === r && cc === c);

export const coordName = (r, c) => `${COLS[c]}${r + 1}`;
export function parseCoord(text) {
  const m = /^([A-E])([1-9]|1[0-2])$/.exec(String(text ?? "").trim().toUpperCase());
  if (!m) return null;
  const c = m[1].charCodeAt(0) - 65;
  const r = Number(m[2]) - 1;
  return { r, c };
}

/** 本方可摆位（25 个）：本方 6 行内除行营（大本营可摆）。从左到右、从上到下。 */
export function setupCells(seat) {
  const ordered = seat === 0 ? [6, 7, 8, 9, 10, 11] : [0, 1, 2, 3, 4, 5];
  const out = [];
  for (const r of ordered) {
    for (let c = 0; c < 5; c += 1) {
      if (!campOfSeat(seat, r, c)) out.push([r, c]);
    }
  }
  return out; // 恒 25
}

/** 模板阵库（Q6：4 型，逐格点数校验过 25 子多重集；随机抽取代摆）。
 *  索引序 = setupCells(0)（A7..E7, A8..E8, A9/C9/E9, A10/B10/D10/E10, A11/C11/E11, A12..E12）；
 *  seat 1 取 180° 旋转（数组反转——两方可摆位序列互为镜像，行营拓扑对称），
 *  约束（后两排雷/旗进大本营/炸不进首排）随旋转对称成立。 */
export function templateSetup(kind = Math.floor(Math.random() * 4), seat = 0) {
  const K = [
    // 0 旗右（D12）雷聚护旗（C11/C12/E12），司令 A11 坐镇
    ["排长", "工兵", "连长", "工兵", "排长", "团长", "排长", "炸弹", "营长", "连长", "工兵", "连长", "师长", "团长", "旅长", "师长", "炸弹", "司令", "地雷", "旅长", "军长", "营长", "地雷", "军旗", "地雷"],
    // 1 旗左（B12）雷左聚
    ["排长", "工兵", "连长", "工兵", "排长", "团长", "连长", "炸弹", "团长", "营长", "工兵", "连长", "师长", "炸弹", "旅长", "旅长", "师长", "排长", "地雷", "司令", "地雷", "军旗", "地雷", "营长", "军长"],
    // 2 旗右雷散（雷 A11/E11/A12），炸前置二线
    ["连长", "工兵", "营长", "排长", "工兵", "营长", "炸弹", "团长", "旅长", "连长", "排长", "师长", "团长", "连长", "炸弹", "师长", "旅长", "地雷", "军长", "地雷", "地雷", "排长", "工兵", "军旗", "司令"],
    // 3 旗左雷中聚，司令 A11
    ["连长", "工兵", "排长", "工兵", "连长", "团长", "工兵", "炸弹", "营长", "排长", "连长", "师长", "军长", "团长", "营长", "旅长", "旅长", "司令", "地雷", "师长", "地雷", "军旗", "地雷", "排长", "炸弹"],
  ];
  const list = K[Math.abs(kind) % K.length];
  return (seat === 1 ? [...list].reverse() : list).join(",");
}

/** 校验布阵（Q6）：返回 { ok } 或 { ok:false, reasons:[明细] }。 */
export function validateSetup(seat, list) {
  const reasons = [];
  const cells = setupCells(seat);
  if (!Array.isArray(list) || list.length !== 25) {
    return { ok: false, reasons: [`布阵必须恰好 25 项（收到 ${list?.length ?? 0} 项）`] };
  }
  // 多重集匹配
  const norm = list.map((x) => String(x).trim());
  const pool = [...FULL_SET];
  for (const zh of norm) {
    const i = pool.indexOf(zh);
    if (i < 0) { reasons.push(`「${zh}」不是有效棋子（应为：司令/军长/师长/旅长/团长/营长/连长/排长/工兵/地雷/炸弹/军旗，且数量须与标准 25 子一致）`); }
    else pool.splice(i, 1);
  }
  if (!reasons.length && pool.length) reasons.push(`棋子数量不符：还缺 ${[...new Set(pool)].join("、")} 等 ${pool.length} 子`);
  if (reasons.length) return { ok: false, reasons };
  // 位置约束
  norm.forEach((zh, i) => {
    const [r, c] = cells[i];
    const name = coordName(r, c);
    if (zh === "军旗" && !hqOfSeat(seat, r, c)) reasons.push(`军旗必须摆进大本营（${HQ[seat].map(([rr, cc]) => coordName(rr, cc)).join(" 或 ")}），你放在了 ${name}`);
    const backRows = seat === 0 ? [10, 11] : [0, 1];
    if (zh === "地雷" && !backRows.includes(r)) reasons.push(`地雷只能摆本方后两排，你把地雷放在了 ${name}`);
    const frontRow = seat === 0 ? 6 : 5;
    if (zh === "炸弹" && r === frontRow) reasons.push(`炸弹不能摆在本方第一排（${name}）`);
  });
  return reasons.length ? { ok: false, reasons } : { ok: true };
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

/** 走法生成（模块级纯函数，junqi/fanqi 共用）：
 *  board: 12×5 的 {side,type,revealed}|null；hqLock=大本营入内锁死（暗棋开/翻棋关）；
 *  营内不可被攻击、铁路直线不可越子、工兵铁路网 BFS。 */
export function movementTargets(board, r, c, { hqLock = true } = {}) {
  const N_ROWS = 12;
  const at = (rr, cc) => board[rr][cc];
  const piece = at(r, c);
  if (!piece || piece.type === "地雷" || piece.type === "军旗") return [];
  if (hqLock && HQ.some((side) => side.some(([rr, cc]) => rr === r && cc === c))) return [];
  const campAt = (rr, cc) => CAMPS.some((side) => side.some(([x, y]) => x === rr && y === cc));
  const railAt = isRail;
  const stepNeighbors = () => {
    const out = [];
    for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= N_ROWS || cc < 0 || cc >= 5) continue;
      if (dr !== 0 && dc !== 0 && !campAt(r, c) && !campAt(rr, cc)) continue; // 斜线仅行营端点
      out.push([rr, cc]);
    }
    return out;
  };
  const railSlides = () => {
    const out = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < N_ROWS && cc >= 0 && cc < 5 && railAt(rr, cc)) {
        const occ = at(rr, cc);
        if (occ) {
          if (occ.side !== piece.side && !campAt(rr, cc)) out.push([rr, cc]);
          break;
        }
        out.push([rr, cc]);
        rr += dr; cc += dc;
      }
    }
    return out;
  };
  const railBfs = () => {
    const seen = new Set([`${r},${c}`]);
    const queue = [[r, c]];
    const out = [];
    while (queue.length) {
      const [cr, cc] = queue.shift();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = cr + dr;
        const ncc = cc + dc;
        if (rr < 0 || rr >= N_ROWS || ncc < 0 || ncc >= 5 || !railAt(rr, ncc)) continue;
        const key = `${rr},${ncc}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const occ = at(rr, ncc);
        if (occ) {
          if (occ.side !== piece.side && !campAt(rr, ncc)) out.push([rr, ncc]);
          continue;
        }
        out.push([rr, ncc]);
        queue.push([rr, ncc]);
      }
    }
    return out;
  };
  const out = new Map();
  const add = (rr, cc) => out.set(`${rr},${cc}`, [rr, cc]);
  for (const [rr, cc] of stepNeighbors()) {
    const occ = at(rr, cc);
    if (!occ) add(rr, cc);
    else if (occ.side !== piece.side && !campAt(rr, cc)) add(rr, cc);
  }
  if (railAt(r, c)) {
    const rail = piece.type === "工兵" ? railBfs() : railSlides();
    for (const [rr, cc] of rail) add(rr, cc);
  }
  return [...out.values()];
}

/** 行棋启发式（2026-11-07 增强，模块级纯函数可测——movementTargets 同级导出）：
 *  ① 扛旗（敌旗已亮明/明棋且可攻）即胜必选；② 攻敌大本营内敌子（HQ 锁死
 *  只进不出：旗/入营子，价值全场最高）；③ 普通攻击司令避战（炸弹同尽/同级
 *  兑亏最大，军长/师长/旅长先上，全剩司令才用）；④ 向敌方阵地推进；⑤ 随机。
 *  at(坐标串)→棋子；foeHq(坐标串)→是否敌大本营；flagCell=可见敌旗坐标串。 */
export function pickJunqiMove({ acts, at, seat, flagCell, foeHq, rng = Math.random }) {
  const P = /^move:([A-E](?:[1-9]|1[0-2]))-([A-E](?:[1-9]|1[0-2]))$/i;
  const info = (a) => { const m = P.exec(a); return m ? { from: m[1], to: m[2] } : null; };
  if (flagCell) {
    const hit = acts.find((a) => info(a)?.to === flagCell);
    if (hit) return hit;
  }
  const hqHits = acts.filter((a) => {
    const p = info(a);
    if (!p) return false;
    const v = at(p.to);
    return v && v.side !== seat && foeHq(p.to);
  });
  if (hqHits.length) return hqHits[Math.floor(rng() * hqHits.length)];
  const attacks = acts.filter((a) => { const p = info(a); return p && at(p.to); });
  if (attacks.length) {
    const tOf = (a) => at(info(a).from)?.type;
    const mid = attacks.filter((a) => ["军长", "师长", "旅长"].includes(tOf(a)));
    const notSiling = attacks.filter((a) => tOf(a) !== "司令");
    const pool = mid.length ? mid : (notSiling.length ? notSiling : attacks);
    return pool[Math.floor(rng() * pool.length)];
  }
  const forward = acts.filter((a) => {
    const p = info(a);
    if (!p) return false;
    const r0 = Number(p.from.slice(1)), r1 = Number(p.to.slice(1));
    return seat === 0 ? r1 < r0 : r1 > r0;
  });
  const pool = forward.length ? forward : acts;
  return pool[Math.floor(rng() * pool.length)];
}

export function createJunqiGame({ seed = Date.now() % 2 ** 31, opts = {} } = {}) {
  const rng = mulberry32(seed);
  const revealAll = !!(opts?.revealAll); // Q2：明棋档（观察层全员亮明，裁决不变）
  // board[r][c] = null | { side: 0|1, type, revealed }（revealed=已翻尸/明棋）
  const board = Array.from({ length: N_ROWS }, () => new Array(5).fill(null));
  const setups = [null, null]; // 双方布阵串（代摆透明标注用）
  const setupSubbed = [false, false];
  const deadBy = [[], []]; // 各方阵亡亮明名单
  let flagRevealed = [false, false]; // 司令阵亡 → 军旗亮明
  let phase = "setup";
  let turn = 0;
  let setupSeatOrder = [0, 1];
  let ended = null;
  const hist = [];
  let lastDetail = null;
  let lastSuggestWasSetupTemplate = false;

  const pieceAt = (r, c) => board[r][c];
  const ownCells = (seat) => (seat === 0 ? { r0: 6, r1: 11 } : { r0: 0, r1: 5 });

  /** 公路一步邻接（行营 8 向：任一端在行营即可斜连，进出对称）。 */
  function stepNeighbors(r, c) {
    const out = [];
    for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= N_ROWS || cc < 0 || cc >= 5) continue;
      if (dr !== 0 && dc !== 0 && !isCamp(r, c) && !isCamp(rr, cc)) continue; // 斜线仅行营端点
      out.push([rr, cc]);
    }
    return out;
  }

  /** 铁路直线滑行目标（非工兵）：四正向直到阻挡/出界；可停空点或敌方非行营子。 */
  function railSlides(r, c) {
    const out = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < N_ROWS && cc >= 0 && cc < 5 && isRail(rr, cc)) {
        if (pieceAt(rr, cc)) {
          if (pieceAt(rr, cc).side !== pieceAt(r, c).side && !isCamp(rr, cc)) out.push([rr, cc]);
          break;
        }
        out.push([rr, cc]);
        rr += dr; cc += dc;
      }
    }
    return out;
  }

  /** 工兵铁路 BFS：铁路网内任意空路径可达点（含网内敌方子终点）。 */
  function railBfs(r, c) {
    const side = pieceAt(r, c).side;
    const seen = new Set([`${r},${c}`]);
    const queue = [[r, c]];
    const out = [];
    while (queue.length) {
      const [cr, cc] = queue.shift();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = cr + dr;
        const ncc = cc + dc;
        if (rr < 0 || rr >= N_ROWS || ncc < 0 || ncc >= 5 || !isRail(rr, ncc)) continue;
        const key = `${rr},${ncc}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const occ = pieceAt(rr, ncc);
        if (occ) {
          if (occ.side !== side && !isCamp(rr, ncc)) out.push([rr, ncc]);
          continue; // 敌子可作终点但不可穿越；己子挡路
        }
        out.push([rr, ncc]);
        queue.push([rr, ncc]);
      }
    }
    return out;
  }

  /** 合法行棋目标集合（含攻击目标）。 */
  const moveTargets = (r, c) => movementTargets(board, r, c, { hqLock: true });

  /** 碰撞裁决（Q2 表）。返回 { ev, over }；ev 描述胜负/翻尸。 */
  function resolveAttack(from, to, mover, victim) {
    const at = coordName(...to);
    const events = [];
    if (victim.type === "军旗") {
      board[to[0]][to[1]] = mover;
      board[from[0]][from[1]] = null;
      events.push({ t: "flag", seat: mover.side, at });
      ended = {
        over: true, ranks: mover.side === 0 ? [0, 1] : [1, 0],
        scores: null, draw: false,
        summary: `${mover.side === 0 ? "下方" : "上方"}攻入${at}扛旗获胜`,
      };
      return events;
    }
    let moverDies = false, victimDies = false;
    let note = "";
    if (mover.type === "炸弹" || victim.type === "炸弹") { moverDies = true; victimDies = true; note = "炸弹同归于尽"; }
    else if (victim.type === "地雷") {
      if (mover.type === "工兵") { victimDies = true; note = "工兵挖雷成功"; }
      else { moverDies = true; note = "撞上地雷阵亡"; }
    } else {
      const a = RANK[mover.type], b = RANK[victim.type];
      if (a > b) { victimDies = true; note = `${mover.type}吃掉${victim.type}`; }
      else if (a < b) { moverDies = true; note = `进攻失败，${victim.type}吃掉${mover.type}`; }
      else { moverDies = true; victimDies = true; note = `${mover.type}同级相拼同归于尽`; }
    }
    if (victimDies) {
      deadBy[victim.side].push(victim.type);
      if (victim.type === "司令") flagRevealed[victim.side] = true; // 司令阵亡 → 军旗亮
      board[to[0]][to[1]] = null;
    }
    if (moverDies) {
      deadBy[mover.side].push(mover.type);
      if (mover.type === "司令") flagRevealed[mover.side] = true;
      board[from[0]][from[1]] = null;
    }
    if (!moverDies && victimDies) board[to[0]][to[1]] = mover; // 攻方胜占位
    if (!moverDies && !victimDies) { /* 不会发生（全分支必有死者） */ }
    if (moverDies && !victimDies) { /* 攻方亡，守方原地 */ }
    events.push({
      t: "battle", seat: mover.side, at,
      mover: mover.type, moverDies,
      victimDies, victimRevealed: victimDies ? victim.type : null,
      note,
    });
    return events;
  }

  /** 困毙/终局检查：行棋方无任何合法着 → 判负（无子可动）。 */
  function checkStalemate(seat) {
    const { r0, r1 } = ownCells(seat);
    for (let r = r0; r <= r1; r += 1) for (let c = 0; c < 5; c += 1) {
      const p = pieceAt(r, c);
      if (p && p.side === seat && moveTargets(r, c).length) return;
    }
    ended = {
      over: true, ranks: seat === 0 ? [1, 0] : [0, 1],
      scores: null, draw: false,
      summary: `${seat === 0 ? "下方" : "上方"}无子可动，判负`,
    };
  }

  function boardTextFor(seat) {
    const lines = [];
    const head = `     ${COLS.split("").join("    ")}`;
    lines.push(head);
    for (let r = 0; r < N_ROWS; r += 1) {
      const cells = [];
      for (let c = 0; c < 5; c += 1) {
        const p = pieceAt(r, c);
        const tag = isCamp(r, c) ? "营" : isHq(r, c) ? "基" : "　";
        if (!p) cells.push(`·${tag}`);
        else if (p.side === seat || revealAll || p.revealed) cells.push(`${p.type}${tag}`); // type 已是中文名
        else if (p.type === "军旗" && flagRevealed[p.side]) cells.push(`旗${tag}`);
        else cells.push(`暗${tag}`);
      }
      lines.push(`${String(r + 1).padStart(2, " ")} ${cells.join(" ")}`);
    }
    return lines.join("\n");
  }

  const game = {
    seats: () => 2,
    phase: () => (ended ? "over" : phase),
    seatLabel: (s) => (s === 0 ? "下方·蓝" : "上方·红"),
    /** Q6：布阵代摆不连坐行棋代走（MatchRunner 消费）。 */
    setupSubstitution: () => lastSuggestWasSetupTemplate,
    pendingAction() {
      if (ended) return null;
      if (phase === "setup") {
        const seat = setupSeatOrder.find((s) => setups[s] == null);
        if (seat == null) { phase = "play"; turn = 0; lastSuggestWasSetupTemplate = false; }
        else return { seat, kind: "setup", actions: [`setup:${templateSetup(0, seat)}`] };
      }
      if (phase === "play") {
        checkStalemate(turn);
        if (ended) return null;
        const acts = [];
        const { r0, r1 } = ownCells(turn);
        for (let r = r0; r <= r1; r += 1) for (let c = 0; c < 5; c += 1) {
          const p = pieceAt(r, c);
          if (p && p.side === turn) {
            for (const [rr, cc] of moveTargets(r, c)) acts.push(`move:${coordName(r, c)}-${coordName(rr, cc)}`);
          }
        }
        if (!acts.length) return null; // checkStalemate 已裁
        return { seat: turn, kind: "move", actions: acts };
      }
      return null;
    },
    apply(seat, action) {
      if (ended) return { ok: false, reason: "对局已结束" };
      const pending = this.pendingAction();
      if (!pending) return { ok: false, reason: "当前无可执行动作" };
      if (pending.seat !== seat) return { ok: false, reason: "还没轮到你" };
      const s = String(action).trim();
      if (phase === "setup") {
        const m = /^setup:(.+)$/.exec(s);
        if (!m) return { ok: false, reason: '布阵格式："setup:司令,军长,师长,…（恰好 25 项，按可摆位从左到右、从上到下）"' };
        const list = m[1].split(/[,，、\s]+/).filter(Boolean);
        const v = validateSetup(seat, list);
        if (!v.ok) {
          return { ok: false, reason: `布阵非法：${v.reasons.join("；")}。可摆位顺序（本方从左到右、从上到下）：${setupCells(seat).map(([r, c]) => coordName(r, c)).join(" ")}` };
        }
        const cells = setupCells(seat);
        list.forEach((zh, i) => {
          const [r, c] = cells[i];
          board[r][c] = { side: seat, type: zh, revealed: false }; // type=中文名（RANK/VALUE 同键）
        });
        setups[seat] = m[1];
        hist.push({ seat, move: "setup" });
        if (setups.every((x) => x != null)) { phase = "play"; turn = 0; lastSuggestWasSetupTemplate = false; }
        lastDetail = { t: "setup", seat, subbed: setupSubbed[seat] };
        return { ok: true, events: [lastDetail] };
      }
      // 行棋
      const mm = /^move:([A-E](?:[1-9]|1[0-2]))-([A-E](?:[1-9]|1[0-2]))$/i.exec(s); // i 容忍小写坐标，不再整串大写（move: 前缀会被 upper 毁掉）
      if (!mm) return { ok: false, reason: '着法格式："move:A4-A5"（起点-终点，列 A-E 行 1-12）' };
      const from = parseCoord(mm[1]);
      const to = parseCoord(mm[2]);
      const p = pieceAt(from.r, from.c);
      if (!p || p.side !== seat) return { ok: false, reason: `${mm[1]} 上没有你的棋子` };
      if (p.type === "地雷" || p.type === "军旗") return { ok: false, reason: `${p.type}不能移动` };
      if (hqOfSeat(p.side, from.r, from.c)) return { ok: false, reason: "进入大本营的棋子不能再移动" };
      const legal = moveTargets(from.r, from.c).some(([rr, cc]) => rr === to.r && cc === to.c);
      if (!legal) {
        const sample = moveTargets(from.r, from.c).slice(0, 8).map(([rr, cc]) => coordName(rr, cc)).join(" ");
        return { ok: false, reason: `${mm[1]}→${mm[2]} 不是合法着法（该子可去：${sample || "无处可去"}；行营内不可被攻击、铁路直线不可越子、大本营锁死）` };
      }
      const victim = pieceAt(to.r, to.c);
      let evs;
      if (victim) {
        evs = resolveAttack([from.r, from.c], [to.r, to.c], p, victim);
      } else {
        board[to.r][to.c] = p;
        board[from.r][from.c] = null;
        evs = [{ t: "move", seat, from: mm[1], to: mm[2] }];
      }
      hist.push({ seat, move: `${mm[1]}-${mm[2]}` });
      lastDetail = evs[0];
      if (!ended) turn = 1 - turn;
      return { ok: true, events: evs };
    },
    result: () => ended,
    viewFor(seat) {
      if (phase === "setup" && setups[seat] == null) {
        return [
          "【两人暗棋军棋（陆战棋）·布阵阶段】",
          `你执${seat === 0 ? "下方（行 7-12）" : "上方（行 1-6）"}。棋盘 12 行 × 5 列（列 A-E，A1=左上角）。行营（不可摆子、8 向安全区）：${CAMPS[seat].map(([r, c]) => coordName(r, c)).join("、")}；大本营：${HQ[seat].map(([r, c]) => coordName(r, c)).join("、")}（军旗必须摆其一，入大本营的子不能再动）。铁路：A/E 两列全线 + 第 2、11 行（直线滑行任意远、不可越子；工兵可在铁路网内转弯）`,
          "布阵约束：恰好 25 子；地雷只摆本方后两排；炸弹不进本方第一排；军旗进大本营。",
          `动作格式："setup:司令,军长,师长,…" —— 25 项按本方可摆位从左到右、从上到下填：${setupCells(seat).map(([r, c]) => coordName(r, c)).join(" ")}`,
          "子力大小：司令>军长>师长>旅长>团长>营长>连长>排长>工兵；同级同尽；炸弹与任何子同尽；地雷只被工兵挖；攻入敌大本营扛旗即胜。对方看不到你的布阵（暗棋），碰撞由裁判裁决并公布结果。",
        ].join("\n");
      }
      const lines = [];
      lines.push(`【两人暗棋军棋】你执${seat === 0 ? "下方（行 7-12）" : "上方（行 1-6）"}${revealAll ? "（明棋档）" : ""}。${ended ? "对局已结束" : `轮到${turn === seat ? "你" : "对方"}行棋`}。棋盘（暗=对方身份未知，营=行营安全区，基=大本营）：`);
      lines.push(boardTextFor(seat));
      const deadSelf = deadBy[seat].filter(Boolean);
      const deadFoe = deadBy[1 - seat].filter(Boolean);
      lines.push(`已损失（你方翻开）：${deadSelf.join("、") || "无"}｜已歼灭（敌方翻开）：${deadFoe.join("、") || "无"}${flagRevealed[1 - seat] ? "｜敌司令已亡：敌军旗已亮明" : ""}`);
      const recent = hist.slice(-10).map((h) => `${h.seat === 0 ? "下" : "上"}${h.move}`).join("，");
      if (recent) lines.push(`最近着法（旧→新）：${recent}`);
      const pend = this.pendingAction();
      if (pend && pend.seat === seat && pend.kind === "move") {
        lines.push(`轮到你。可行动作 ${pend.actions.length} 个（示例：${pend.actions.slice(0, 10).join(" ")}${pend.actions.length > 10 ? " …" : ""}）。`);
      }
      return lines.join("\n");
    },
    suggestAction(seat) {
      const pend = this.pendingAction();
      if (!pend) return null;
      if (pend.kind === "setup") {
        // Q6：模板阵库随机代摆（setupSubstitution → 不计行棋代走）
        lastSuggestWasSetupTemplate = true;
        return `setup:${templateSetup(Math.floor(rng() * 4), seat)}`;
      }
      lastSuggestWasSetupTemplate = false;
      const acts = pend.actions;
      // 可见敌旗（司令阵亡亮明 / 明棋档）：坐标扫描交给 ① 扛旗优先
      let flagCell = null;
      for (let r = 0; r < N_ROWS && !flagCell; r += 1) for (let c = 0; c < 5 && !flagCell; c += 1) {
        const q = pieceAt(r, c);
        if (q && q.side !== seat && q.type === "军旗" && (flagRevealed[q.side] || revealAll)) flagCell = coordName(r, c);
      }
      return pickJunqiMove({
        acts,
        at: (name) => { const p = parseCoord(name); return p ? pieceAt(p.r, p.c) : null; },
        seat,
        flagCell,
        foeHq: (name) => { const p = parseCoord(name); return p ? hqOfSeat(1 - seat, p.r, p.c) : false; },
        rng,
      });
    },
    getState() {
      return {
        phase: this.phase(), turn,
        board: board.map((row) => row.map((p) => (p ? { side: p.side, type: p.type, revealed: p.revealed } : null))),
        setups: [...setups], setupSubbed: [...setupSubbed],
        deadBy: deadBy.map((d) => [...d]), flagRevealed: [...flagRevealed],
        hist: hist.slice(-20), lastMove: lastDetail, revealAll,
      };
    },
  };
  return game;
}

registerGame({
  id: "junqi",
  label: "军棋暗棋",
  short: "军棋",
  desc: "两人陆战棋暗棋：布阵+行棋+裁判裁决碰撞，扛旗获胜",
  order: 7,
  cat: "board",
  color: "#5a6b3d",
  boardKind: "junqi",
  seats: 2,
  minSeats: 2,
  createGame: createJunqiGame,
  scored: false,
});
