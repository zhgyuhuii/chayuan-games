/**
 * 五子棋规则核心（games-llm-arena-plan Q1/Q8：LLM 是大脑、代码是唯一裁判；
 * 规则自写——lihongxun945/gobang（MIT）核验过可借力，但本项目走参考自写，
 * 规则通则本身不受版权保护，零第三方代码进包）。
 *
 * 规则口径（简化声明进对局摘要）：15×15 自由五子棋，无禁手（黑先也不设
 * 三三/三三禁手——LLM 对局挂禁手只会放大非法步率），≥5 连即胜（六连也算）。
 * 动作格式：ICCS 式坐标 <列字母A-O><行号1-15>，如 "H8" = 天元。
 *
 * 启发式代走（Q2 B 代走制：非纯随机）评分制：
 *   成五 > 挡对方成五 > 己方活四/冲四 > 挡对方活四 > 己方活三 > 邻子密度。
 */
import { registerGame, SEAT_NAMES } from "../registry.js";

export const SIZE = 15;
const COLS = "ABCDEFGHIJKLMNO"; // 15 路
const MOVE_MAX = SIZE * SIZE; // 全满 = 和

export const colName = (c) => COLS[c];
export const rowName = (r) => String(r + 1);
export function toMove(r, c) { return `${COLS[c]}${r + 1}`; }
/** "H8" → {r,c}；不合法返回 null。 */
export function parseMove(s) {
  if (typeof s !== "string" || s.length < 2) return null;
  const c = COLS.indexOf(s[0].toUpperCase());
  const r = parseInt(s.slice(1), 10) - 1;
  if (c < 0 || r < 0 || r >= SIZE || !Number.isInteger(r)) return null;
  return { r, c };
}

/** 全部空点（合法动作全集）。 */
function emptyPoints(board) {
  const out = [];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[r][c] === 0) out.push(toMove(r, c));
  }
  return out;
}

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
/** (r,c) 落 side 后是否 ≥5 连。 */
export function winsAt(board, r, c, side) {
  for (const [dr, dc] of DIRS) {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === side) {
        n += 1; rr += dr * s; cc += dc * s;
      }
    }
    if (n >= 5) return true;
  }
  return false;
}

/**
 * 代走评分（Q2：能挡杀就挡、能吃就吃——五子棋无吃子，挡杀=挡对方成五）。
 * 候选 = 邻域空点（半径 2）；空盘 = 天元。
 */
function lineScore(board, r, c, side) {
  // 该点对 side 的进攻价值：四方向统计 (连子数, 开放端)
  let score = 0;
  for (const [dr, dc] of DIRS) {
    let run = 0, open = 0;
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      let endOpen = false;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === side) {
        run += 1; rr += dr * s; cc += dc * s;
      }
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === 0) endOpen = true;
      if (endOpen) open += 1;
    }
    if (run + 1 >= 5) score += 1_000_000; // 落即成五
    else if (run === 3 && open === 2) score += 50_000; // 活四
    else if (run === 3) score += 9_000; // 冲四
    else if (run === 2 && open === 2) score += 1_200; // 活三
    else score += (run + 1) * (run + 1) * 12 * (open + 1);
  }
  return score;
}

/** 邻域候选（半径 2 内空点；空盘给天元）。 */
export function neighborhood(board, radius = 2) {
  const out = [];
  let any = false;
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[r][c] !== 0) { any = true; r = SIZE; break; }
  }
  if (!any) return [toMove(7, 7)];
  for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) {
    if (board[r][c] !== 0) continue;
    let near = false;
    for (let dr = -radius; dr <= radius && !near; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] !== 0) { near = true; break; }
      }
    }
    if (near) out.push(toMove(r, c));
  }
  return out;
}

export function createGobangGame({ seatOrder } = {}) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  const moves = []; // { seat, r, c, move }
  let turn = seatOrder?.[0] ?? 0; // 0=黑先

  const state = () => ({
    board: board.map((row) => [...row]),
    turn,
    moves: moves.map((m) => ({ ...m })),
    size: SIZE,
  });

  return {
    seats: () => 2,
    phase: () => "play",
    seatLabel: (s) => (s === 0 ? "黑" : "白"),
    pendingAction() {
      if (this.result()) return null;
      return { seat: turn, kind: "move", actions: emptyPoints(board) };
    },
    apply(seat, action) {
      const res = this.result();
      if (res) return { ok: false, reason: "对局已结束" };
      if (seat !== turn) return { ok: false, reason: "还没轮到你" };
      const p = parseMove(action);
      if (!p) return { ok: false, reason: `坐标 ${JSON.stringify(action)} 不合法，格式如 "H8"（列 A-O + 行 1-15）` };
      if (board[p.r][p.c] !== 0) return { ok: false, reason: `${action} 已有棋子` };
      board[p.r][p.c] = seat + 1;
      moves.push({ seat, r: p.r, c: p.c, move: action });
      turn = 1 - turn;
      return { ok: true, events: [{ t: "move", seat, move: action }] };
    },
    /** 悔棋（2026-11-06 人机模式）：无吃子，弹步清格即复原；行棋方按剩余
     *  手数重算（黑先）。与 xiangqi.undoPlies 同名同约（MatchRunner 消费）。 */
    undoPlies(n) {
      const count = Math.max(0, Math.min(n | 0, moves.length));
      for (let i = 0; i < count; i += 1) {
        const e = moves.pop();
        board[e.r][e.c] = 0;
      }
      turn = moves.length % 2;
      return count;
    },
    result() {
      const last = moves[moves.length - 1];
      if (last && winsAt(board, last.r, last.c, last.seat + 1)) {
        const winner = last.seat;
        return { over: true, ranks: [winner, 1 - winner], summary: `${winner === 0 ? "黑" : "白"}方五连获胜（${last.move}）`, winner };
      }
      if (moves.length >= MOVE_MAX) return { over: true, ranks: [0, 0], draw: true, summary: "棋盘落满，和棋" };
      return null;
    },
    /** 观察序列化（§三）：着法历史优先 + 邻域候选（225 空点全列浪费 token，
     *  legalActions 仍是全集，这里给收敛候选并声明「任意空位均可」）。 */
    viewFor(seat) {
      const hist = moves.map((m, i) => `${i + 1}. ${m.seat === 0 ? "黑" : "白"} ${m.move}`).join("，") || "（空盘，你是第一手）";
      const cands = neighborhood(board).slice(0, 60);
      return [
        `【五子棋】15×15 自由规则（无禁手，≥5 连即胜）。你是 ${seat === 0 ? "黑（先手）" : "白（后手）"}。`,
        `着法历史：${hist}`,
        `轮到你落子。推荐候选（也可是任意空位坐标）:${cands.join(" ")}`,
        '坐标格式：列字母A-O + 行号1-15，如 "H8"。',
      ].join("\n");
    },
    suggestAction(seat) {
      const cands = neighborhood(board);
      let best = cands[0], bestScore = -1;
      for (const mv of cands) {
        const p = parseMove(mv);
        // 进攻 + 挡杀（对方在该点成五的分量与己方成五同级——能挡杀就挡）
        const sc = lineScore(board, p.r, p.c, seat + 1) + lineScore(board, p.r, p.c, (1 - seat) + 1) * 0.9;
        if (sc > bestScore) { bestScore = sc; best = mv; }
      }
      return best;
    },
    getState: state,
    seatNames: SEAT_NAMES,
  };
}

registerGame({
  id: "gobang",
  label: "五子棋",
  short: "五子",
  desc: "15×15 自由五子棋，五连即胜（无禁手）",
  order: 1,
  cat: "board",
  color: "#e8b04b",
  boardKind: "grid",
  seats: 2,
  minSeats: 2,
  createGame: createGobangGame,
});
