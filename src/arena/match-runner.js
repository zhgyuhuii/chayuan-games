/**
 * MatchRunner（games-llm-arena-plan §三）：对局引擎——回合驱动、Q2 代走
 * 兜底状态机、事件流与快照落盘、每步耗时/调用量记录。
 *
 * Q2 B 代走制语义：非法/不可解析/调用失败 → 回喂合法步清单+上次错误原因
 * 重试 2 次 → 仍非法由裁判启发式代走（事件标 substituted:true）→ 单局代走
 * 超 5 次判负（ranks 垫底，其余并列第一——惩罚性简化口径，注释存档）。
 *
 * 匿名观战（Q6 默认开）：棋谱本身存真实选手 id（终局可揭晓），对局中的
 * 玩家显示层匿名（玩家A/B/C/D）由 UI 消费 events 时处理。
 * 人机模式：人类非法步不经代走状态机（UI 按合法集渲染，正常不会出现；
 * 异常输入直接提示重选），人类认输直接垫底。
 */
import { systemPrompt, retryPrompt } from "./prompts.js";
import { salvageMove } from "./players.js";
import { fetchBookHint } from "./bookRag.js";

/** 开局记忆提示（P2 #4）：该模型执此座位的同开局历史战绩（w>l 才注入——
 *  只强化有效经验，不放大败线）。纯函数（可测）。 */
export function openingMemoryHint(openMem, playerId, gameId, seat) {
  const entry = openMem?.[`${playerId}|${gameId}|${seat}`];
  if (!entry) return null;
  let best = null;
  let score = -Infinity;
  for (const [line, c] of Object.entries(entry)) {
    const { w = 0, d = 0, l = 0 } = c ?? {};
    if (line.length > 120) continue;
    if (w - l > score) { score = w - l; best = { line, w, d, l }; }
  }
  return best && best.w > best.l
    ? `你此前执此座位用同一开局 ${best.w}胜${best.d}平${best.l}负：${best.line}`
    : null;
}

/** 开局阶段检索隐藏棋谱库（chatop-kb internal-arena-book），最相似定式附到
 *  观察尾部（2026-11-06 用户裁定「塞进向量库、不在知识库显示」）；同段挂
 *  跨局开局记忆（P2 #4）。KB 不可用/超时/非开局/零命中一律静默跳过——
 *  viewFor 内置定式手册恒兜底，对局不因检索挂掉。view 每回合只装饰一次
 *  （重试轮复用同一 view）。 */
async function decorateWithBookHint(game, gameDef, view, openMem, playerId) {
  const book = gameDef?.book;
  const histLen = game.getState()?.hist?.length ?? 0;
  const openingPhase = histLen <= (book?.openingPlies ?? 20);
  let out = view;
  if (book && openingPhase) {
    const q = book.queryOf?.(game) ?? "";
    if (q) {
      try {
        const hint = await fetchBookHint(book.kbId, q);
        if (hint) out = `${out}\n\n相似定式（棋谱库检索，供参考）：${hint}`;
      } catch { /* KB 不可用：静默降级 */ }
    }
  }
  if (openingPhase) {
    const seat = game.getState()?.turn ?? 0;
    const mem = openingMemoryHint(openMem, playerId, gameDef?.id, seat);
    if (mem) out = `${out}\n\n${mem}——沿用有效路线或针对性变着。`;
  }
  return out;
}

let seq = 0;
export const SUB_FORFEIT_LIMIT = 5;
const DEFAULT_MAX_STEPS = 600;

/** 快照瘦身（P2 修复：斗地主 getState 内嵌累积 plays 数组，快照总量 O(n²)
 *  ——实测一局 84KB 超出「一局 <50KB」计划口径；牌桌回放只需最近几手，
 *  全量出牌历史在 record.events 里本来就全量留存）。 */
function slimState(state) {
  if (!state || !Array.isArray(state.plays)) return state;
  return { ...state, plays: state.plays.slice(-8) };
}

/** 思考文本抽取（Q10：思维链模式，模型推理进对局记录/回放思考气泡）。
 *  从 act 返回的 raw（前 400 字）剥掉末尾扁平协议 JSON 与栅栏/答案标记，
 *  剩余正文压空白截 400 字——气泡是「可见心声」不是审计日志；raw 已被
 *  掐尾（推理 >400 字）时 JSON 不在文内，raw 全文即思考，天然成立。 */
function thinkBodyOf(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const body = t.replace(/\{[^{}\n]*\}\s*$/, "").replace(/答案\s*[:：]\s*$/i, "").trim();
  const out = (body || "").replace(/\s+/g, " ").slice(0, 400);
  return out || null;
}

export async function runMatch({
  game,
  gameDef,
  players, // 每座位一个 PlayerAdapter
  playerMeta, // [{ id, label, modelRef, kind, cloud }]（棋谱存档与终局揭晓用）
  mode = "ai_vs_ai", // ai_vs_ai | human_vs_ai
  signal = null,
  onEvent = () => {},
  maxSteps = DEFAULT_MAX_STEPS,
  think = true, // Q10 局级思维链总开关（默认开；关=全员严格裸 JSON 快棋档）
  gameOpts = null, // 游戏级开局面（如军棋明棋档 { revealAll: true }）——原样透传 createGame 的 opts 并落 record.gameOpts（结算/回放消费）
  openingsProvider = null, // 跨局开局记忆供给（2026-11-07 摘建审计裁决：依赖注入——runner 回归纯引擎、两侧同构为真；harness 传 storage.loadOpenings，chayuan-game 传自有实现或 null 降级）
}) {
  const id = `m${Date.now().toString(36)}${(seq += 1).toString(36)}`;
  const seats = game.seats();
  const sys = systemPrompt(gameDef, { personality: null, think });
  // 跨局开局记忆（P2 #4）：供给方注入（openingsProvider），读取失败静默降级
  // （无记忆对局照常）；null 供给 = 无记忆（chayuan-game 降级档）
  let openMem = null;
  try { openMem = openingsProvider ? await openingsProvider() : null; } catch { openMem = null; }
  const stats = Array.from({ length: seats }, () => ({ ms: 0, calls: 0, promptTokens: 0, completionTokens: 0, subs: 0 }));
  const events = [];
  const snapshots = []; // 回放：每步后 getState()
  const push = (ev) => { events.push(ev); onEvent(ev); };

  push({
    t: "start", gameId: gameDef.id, mode, seats, protocol: think ? "cot" : "bare",
    players: playerMeta.map((p, i) => ({ seat: i, id: p.id, kind: p.kind, cloud: p.cloud ?? false })),
    ts: Date.now(),
  });

  const forfeitEnd = (seat, why) => ({
    over: true, forfeit: seat,
    ranks: Array.from({ length: seats }, (_, i) => (i === seat ? seats - 1 : 0)),
    draw: false, scores: null,
    summary: `${playerMeta[seat].label} ${why}`,
  });

  let forcedEnd = null; // 认输/代走超限（game.result() 之外的中止裁定）
  let aborted = false;
  let stepGuard = 0;
  while (!forcedEnd) {
    if (signal?.aborted) { push({ t: "abort", ts: Date.now() }); aborted = true; break; }
    if (stepGuard >= maxSteps) { push({ t: "note", text: `达到步数上限 ${maxSteps}` }); break; }
    if (game.result()?.over) break;
    const pending = game.pendingAction();
    if (!pending) break;
    stepGuard += 1;

    const player = players[pending.seat];
    const seatStats = stats[pending.seat];
    const t0 = Date.now();
    let moveOut = null, commentOut = "", substituted = false, usage = null, applyDetail = null, thinkOut = null;
    let lastRaw = "", lastErrText = "";
    // 形势分（P1 #6/#7）：scored 游戏每步挂双向分数与行棋方摆动（观战条+
    // 着法标注数据源；启发式，不进模型观察）。失败静默跳过（事件无 scores）。
    const canScore = gameDef.scored === true && typeof game.scoreFor === "function";
    let scoresBefore = null;
    if (canScore) {
      try { scoresBefore = Array.from({ length: seats }, (_, i) => game.scoreFor(i)); } catch { scoresBefore = null; }
    }

    if (player.kind === "human") {
      const out = await player.act(game.viewFor(pending.seat), sys, null, signal);
      if (out.move === "__resign__") {
        push({ t: "move", seat: pending.seat, move: "认输", comment: out.comment, substituted: false, ms: Date.now() - t0, ts: Date.now(), resign: true });
        // 认输也落终局快照（2026-11-07「认输后盘面被清空」实锤：此前首手/布阵期认输
        // snapshots 为空 → Room 取不到 state → 棋盘整块消失）
        snapshots.push({ i: snapshots.length, seat: pending.seat, state: slimState(game.getState()) });
        forcedEnd = forfeitEnd(pending.seat, "认输");
        break;
      }
      // 悔棋（2026-11-06 人机模式「回退上一步」）：回退一整轮（AI 应手 + 玩家
      // 这步），快照同步裁剪；note 走 i18n key（Room 翻译，cjk-guard 口径）。
      // 无 undoPlies 的游戏（围棋提子/打劫复杂）UI 不显示按钮，哨兵兜底拒绝。
      if (out.move === "__undo__") {
        const plies = events.filter((e) => e.t === "move").length;
        if (typeof game.undoPlies === "function" && plies >= 2) {
          game.undoPlies(2);
          snapshots.splice(Math.max(0, snapshots.length - 2));
          push({ t: "note", key: "arena.room.undoNote", ts: Date.now() });
        } else {
          push({ t: "note", key: "arena.room.undoDenied", ts: Date.now() });
        }
        continue;
      }
      if (out.move === "__skip__") { // 人工接管放行哨兵（2026-11-07）：AI 接手首步在途时切回人工，
        continue; // 旧 humanPlayer 的 act 必须resolve否则 runner 卡死——弃本轮结果，pendingAction 重取（此时 players[seat] 已换回人工）
      }
      const r = game.apply(pending.seat, out.move);
      if (r.ok) { moveOut = out.move; commentOut = out.comment ?? ""; applyDetail = r.events?.[0] ?? null; }
      // 人类非法步：不代走不重试，直接跳过本轮（UI 已按合法集渲染，此处仅兜底）
      else push({ t: "reject", seat: pending.seat, attempt: 0, move: out.move, reason: r.reason, human: true, ts: Date.now() });
    } else {
      let view = null;
      for (let attempt = 0; attempt <= 2; attempt += 1) {
        try {
          if (signal?.aborted) throw new Error("stopped");
          if (!view) view = await decorateWithBookHint(game, gameDef, game.viewFor(pending.seat), openMem, playerMeta[pending.seat]?.id);
          const retryText = attempt === 0 ? null : retryPrompt(lastRaw, lastErrText, pending.actions, { think });
          const out = await player.act(view, sys, retryText, signal);
          const r = game.apply(pending.seat, out.move);
          if (r.ok) { moveOut = out.move; commentOut = out.comment ?? ""; usage = out.usage ?? null; thinkOut = think ? thinkBodyOf(out.raw) : null; applyDetail = r.events?.[0] ?? null; break; }
          lastRaw = out.move; lastErrText = r.reason;
          push({ t: "reject", seat: pending.seat, attempt, move: out.move, reason: r.reason, ts: Date.now() });
        } catch (e) {
          lastRaw = e?.rawText != null ? String(e.rawText) : "(无输出)";
          lastErrText = e?.message ?? String(e);
          // 无 JSON 文本回捞（2026-11-06 象棋 rambling 实锤：玩家B复述局面/
          // 分析坐标不进协议）——输出全文若含任一「当前合法着法串」的精确
          // 词命中，直接采用，省一整轮重试与裁判代走；事件流透明记录。
          const salv = salvageMove(lastRaw, pending.actions);
          if (salv) {
            const r = game.apply(pending.seat, salv);
            if (r.ok) {
              push({ t: "note", text: `${playerMeta[pending.seat].label} 输出无 JSON，已从文本回捞合法着法 ${salv}`, ts: Date.now() });
              // 气泡显示模型自己的分析原话（回捞那步的真实思路），比干巴巴
              // 的「（文本回捞）」有信息量——回捞事实由 note 事件透明记录
              const analysis = lastRaw.trim().replace(/\s+/g, " ");
              moveOut = salv;
              commentOut = analysis ? `${analysis.slice(0, 60)}…（回捞）` : "（回捞）";
              thinkOut = analysis ? analysis.slice(0, 400) : null; // 回捞步的思考=全文原话（Q10）
              applyDetail = r.events?.[0] ?? null;
              break;
            }
          }
          push({ t: "reject", seat: pending.seat, attempt, move: null, reason: lastErrText, ts: Date.now() });
          if (signal?.aborted) break;
        }
      }
    }

    const ms = Date.now() - t0;
    seatStats.ms += ms;
    if (player.kind === "llm") {
      seatStats.calls += 1;
      if (usage) {
        seatStats.promptTokens += usage.prompt_tokens ?? 0;
        seatStats.completionTokens += usage.completion_tokens ?? 0;
      }
    }

    if (!moveOut && player.kind === "llm" && !signal?.aborted) {
      // Q2：重试穷尽 → 裁判启发式代走（能挡杀就挡、能吃就吃）。
      // games2 Q6 例外（军棋布阵）：模板阵代摆不连坐行棋代走计数（布阵与
      // 行棋是两种技能，TrueSkill 区分度留给行棋——引擎 setupSubstitution 钩子）。
      const mv = game.suggestAction(pending.seat);
      const r = mv ? game.apply(pending.seat, mv) : { ok: false, reason: "无棋可走" };
      if (r.ok) {
        const setupSub = typeof game.setupSubstitution === "function" && game.setupSubstitution();
        moveOut = mv;
        substituted = !setupSub;
        commentOut = setupSub ? "（布阵代摆·模板阵库，不计代走）" : "（裁判代走）";
      }
    }

    if (moveOut) {
      if (substituted) seatStats.subs += 1;
      // 形势分挂载：双向分数（观战条）+ 行棋方摆动（着法标注）
      let scoreExtra = {};
      if (canScore) {
        try {
          const scoresAfter = Array.from({ length: seats }, (_, i) => game.scoreFor(i));
          scoreExtra = {
            scores: scoresAfter,
            swing: scoresBefore ? scoresAfter[pending.seat] - scoresBefore[pending.seat] : 0,
          };
        } catch { /* 评分失败：事件不带 scores */ }
      }
      push({
        t: "move", seat: pending.seat, move: moveOut, comment: commentOut,
        substituted, ms, ts: Date.now(), detail: applyDetail,
        think: thinkOut, // Q10：思维链正文（回放思考气泡；bare 局恒 null）
        usage: usage ? { pt: usage.prompt_tokens ?? 0, ct: usage.completion_tokens ?? 0 } : null,
        ...scoreExtra,
      });
      snapshots.push({ i: snapshots.length, seat: pending.seat, state: slimState(game.getState()) });
      if (seatStats.subs > SUB_FORFEIT_LIMIT) {
        push({ t: "forfeit", seat: pending.seat, subs: seatStats.subs, ts: Date.now() });
        forcedEnd = forfeitEnd(pending.seat, "单局代走超过 5 次判负");
      }
    }
  }

  let final = forcedEnd;
  if (!final) {
    const r = game.result();
    if (r?.over) final = r;
    else if (aborted) final = { over: true, draw: true, ranks: Array.from({ length: seats }, () => 0), scores: null, summary: "对局已中止（未裁定）" };
    else {
      const worst = stats.map((s, i) => ({ i, subs: s.subs })).sort((a, b) => b.subs - a.subs)[0];
      final = {
        over: true,
        ranks: Array.from({ length: seats }, (_, i) => (i === worst?.i ? seats - 1 : 0)),
        draw: true, scores: null,
        summary: "对局中止，按代走次数裁定",
      };
    }
  }

  const endedAt = Date.now();
  // 统一出口：record.ranks = 每座位名次（seat → 名次值，并列同值）——
  // storage/TureSkill 的消费口径（P1 修复：此前游戏侧「按名次排 seat」被
  // 当每座位名次消费，4 人麻将天梯错位）
  const rankOfSeat = (() => {
    if (final.rankNums && final.teams) {
      const out = new Array(seats).fill(0);
      final.teams.forEach((team, ti) => team.forEach((seat) => { out[seat] = final.rankNums[ti]; }));
      return out;
    }
    return [...final.ranks];
  })();
  const ratingTeams = final.teams ?? Array.from({ length: seats }, (_, i) => [i]);
  const ratingRanks = final.rankNums ?? ratingTeams.map((team) => rankOfSeat[team[0]]);
  push({ t: "end", ranks: rankOfSeat, summary: final.summary, draw: !!final.draw, ts: endedAt });
  return {
    id, gameId: gameDef.id, mode, seats, protocol: think ? "cot" : "bare", // Q13：记录级协议标记（回放可筛）
    gameOpts: gameOpts && typeof gameOpts === "object" ? { ...gameOpts } : null, // 游戏级开局面存档（明棋档结算跳过天梯的判据）
    players: playerMeta.map((p, i) => ({ ...p, seat: i })),
    ranks: rankOfSeat, winner: final.winner ?? null, draw: !!final.draw,
    summary: final.summary, scores: final.scores ?? null,
    ratingTeams,
    ratingRanks,
    startedAt: events[0].ts, endedAt, durationMs: endedAt - events[0].ts,
    events, snapshots, stats,
    ratingApplied: false, // storage.applyMatchResult 结算后置 true
  };
}
