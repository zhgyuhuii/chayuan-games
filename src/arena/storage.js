/**
 * 竞技场存储与天梯结算（games-llm-arena-plan Q7）：棋谱 = JSON 事件流本地
 * 全量留存（一局目标 <50KB）；存储跟随 dsh app 现有惯例（os-data loadData/
 * saveData），不新造基础设施。
 *
 * 三个 os-data 文档：
 *  - arena_records：{ list: [record…] } 最新在前，上限 80 条
 *  - arena_ratings：{ [gameId]: { [playerId]: {mu,sigma,played,w,d,l,subs,lastAt} } }
 *  - arena_humans：人类挑战者战绩（Q7 补充裁定：人机不计模型 rating，人类
 *    战绩单列——「人类对某模型胜率」指标）
 *
 * 补充裁定语义（2026-11-03 Q7）：机机对局进天梯；人机对局默认不计入模型
 * rating（人不是天梯选手，防人的变量污染模型智力榜）。
 * 代走积分惩罚（Q2）：胜方 μ 增益按 max(0.5, 1-0.1×subs) 折扣（表现折扣，
 * 简化口径注释存档；代走次数另有棋谱字段与天梯列展示）。
 */
import { loadData, saveData } from "../lib/dataClient.js";
import { rate, newPlayer, oneMatch, expose, tierOf } from "./trueskill.js";

const RECORDS_CAP = 80;

/** games2 Q13 天梯重置：评分清零（对局记录/回放保留为内容资产）。 */
export async function resetRatings() {
  await saveData("arena_ratings", {});
  await saveData("arena_humans", {});
}

export async function loadRecords() {
  const doc = await loadData("arena_records");
  return Array.isArray(doc?.list) ? doc.list : [];
}

export async function saveRecord(record) {
  const list = await loadRecords();
  // 快照瘦身：>300 帧截中段（回放仍连续可见首尾）
  const slim = { ...record };
  if (slim.snapshots?.length > 300) {
    const head = slim.snapshots.slice(0, 100);
    const tail = slim.snapshots.slice(-150);
    slim.snapshots = [...head, { i: -1, elided: slim.snapshots.length - 250 }, ...tail];
  }
  const next = [{ ...slim, savedAt: Date.now() }, ...list].slice(0, RECORDS_CAP);
  await saveData("arena_records", { list: next });
  return next;
}

export async function loadRatings() {
  const doc = await loadData("arena_ratings");
  return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
}

export async function saveRatings(doc) {
  await saveData("arena_ratings", doc ?? {});
}

export async function loadHumans() {
  const doc = await loadData("arena_humans");
  return doc && typeof doc === "object" ? doc : {};
}

/**
 * 对局结算入库：records 追加 + 天梯/人类战绩更新。返回 { ratings, humans }
 * （壳层刷新 UI 用）。
 */
export async function applyMatchResult(record) {
  // 明棋教学档（gameOpts.revealAll，军棋）：双方布阵全程亮明，信息量与暗棋
  // 不同——不进天梯/人类战绩/开局记忆（混记污染口径），只存档供回放复盘。
  if (record.gameOpts?.revealAll) {
    await saveRecord(record);
    return { ratings: await loadRatings(), humans: await loadHumans() };
  }
  const hasHuman = record.players.some((p) => p.kind === "human");
  let ratings = await loadRatings();
  let humans = await loadHumans();

  if (!hasHuman && record.mode !== "test") {
    // 机机 → TrueSkill（Q7）
    ratings = applyRating(ratings, record);
    record.ratingApplied = true;
  } else if (hasHuman) {
    humans = applyHumanResult(humans, record);
  }
  // 天梯/人类战绩落盘（真机实测补漏：只算不存 = 天梯永远空表）
  await saveData("arena_ratings", ratings);
  await saveData("arena_humans", humans);
  // 跨局开局记忆（P2 #4）：胜负归档到开局线谱（读取失败不阻塞结算）
  try {
    await saveData("arena_openings", applyOpenings(await loadOpenings(), record));
  } catch { /* 记忆缺席：对局结算照常 */ }
  await saveRecord(record); // 结算标记先行，落盘的棋谱 ratingApplied 为真值
  return { ratings, humans };
}

/** 纯函数（可测）：天梯结算。 */
export function applyRating(ratingsDoc, record) {
  const doc = JSON.parse(JSON.stringify(ratingsDoc ?? {}));
  const table = doc[record.gameId] ?? {};
  const before = record.ratingTeams.map((team) => team.map((seat) => table[record.players[seat].id] ?? newPlayer()));
  // 局前不确定性回弹（τ）
  const bounced = before.map((t) => t.map(oneMatch));
  const after = rate(bounced, record.ratingRanks, { drawProbability: record.gameId === "xiangqi" ? 0.1 : 0.05 });
  record.ratingTeams.forEach((team, ti) => {
    team.forEach((seat, mi) => {
      const id = record.players[seat].id;
      const prev = table[id] ?? { ...newPlayer(), played: 0, wins: 0, draws: 0, losses: 0, subs: 0 };
      const now = after[ti][mi];
      // Q2 代走惩罚：胜方 μ 增益折扣 max(0.5, 1-0.1×subs)
      const subs = record.stats[seat]?.subs ?? 0;
      const gain = now.mu - bounced[ti][mi].mu;
      const factor = gain > 0 ? Math.max(0.5, 1 - 0.1 * subs) : 1;
      const myRank = record.ratingRanks[ti];
      const bestRank = Math.min(...record.ratingRanks);
      table[id] = {
        mu: bounced[ti][mi].mu + gain * factor,
        sigma: now.sigma,
        played: prev.played + 1,
        wins: prev.wins + (myRank === bestRank && !record.draw ? 1 : 0),
        draws: prev.draws + (record.draw || record.ratingRanks.every((r) => r === myRank) ? 1 : 0),
        losses: prev.losses + (myRank !== bestRank && !record.draw ? 1 : 0),
        subs: prev.subs + subs,
        lastAt: Date.now(),
      };
    });
  });
  doc[record.gameId] = table;
  return doc;
}

/** 纯函数（可测）：人类挑战者战绩（单列，不动模型 rating）。 */
export function applyHumanResult(humansDoc, record) {
  const doc = JSON.parse(JSON.stringify(humansDoc ?? {}));
  const humanSeats = record.players.filter((p) => p.kind === "human");
  for (const h of humanSeats) {
    const key = `${h.id}`;
    const entry = doc[key] ?? { name: h.label, games: {} };
    entry.name = h.label;
    const g = entry.games[record.gameId] ?? { wins: 0, losses: 0, draws: 0, vs: {} };
    const myRank = record.ranks[h.seat];
    const best = Math.min(...record.ranks);
    const isWin = myRank === best && !record.draw;
    const isDraw = record.draw;
    if (isWin) g.wins += 1; else if (isDraw) g.draws += 1; else g.losses += 1;
    for (const p of record.players) {
      if (p.kind === "human") continue;
      const v = g.vs[p.id] ?? { model: p.label, wins: 0, losses: 0, draws: 0 };
      // 该模型的视角 = 人类的反面（人类赢 = 模型负）
      if (isWin) v.losses += 1; else if (isDraw) v.draws += 1; else v.wins += 1;
      g.vs[p.id] = v;
    }
    entry.games[record.gameId] = g;
    doc[key] = entry;
  }
  return doc;
}

/** 模型卡片聚合（2026-11-06 P1 #8）：从棋谱全量记录聚合每模型的观战指标——
 *  局数/步均耗时/代走/回捞（协议救援）/常用开局（前 12 着 zh 记谱聚类取最多）。
 *  纯函数（可测），Ladder 行点击展开消费。 */
export function modelStatsFromRecords(records) {
  const acc = new Map();
  for (const rec of records ?? []) {
    if (rec.mode === "test") continue;
    const moves = (rec.events ?? []).filter((e) => e.t === "move");
    const opening = moves.slice(0, 12)
      .map((e) => e.detail?.zh ?? e.move).join(" ");
    const salvageBySeat = new Array(rec.seats ?? 2).fill(0);
    for (const e of rec.events ?? []) {
      if (e.t !== "note" || !String(e.text ?? "").includes("回捞")) continue;
      for (let s = 0; s < (rec.seats ?? 2); s += 1) {
        if (String(e.text).startsWith(`${rec.players?.[s]?.label} `)) salvageBySeat[s] += 1;
      }
    }
    const bestRank = Math.min(...(rec.ranks ?? [0]));
    (rec.players ?? []).forEach((p, s) => {
      if (p.kind !== "llm") return;
      const a = acc.get(p.id) ?? { id: p.id, games: 0, wins: 0, ms: 0, steps: 0, calls: 0, subs: 0, salvages: 0, openings: new Map() };
      const st = rec.stats?.[s] ?? {};
      a.games += 1;
      a.wins += (rec.ranks?.[s] === bestRank && !rec.draw) ? 1 : 0;
      a.ms += st.ms ?? 0;
      a.steps += moves.filter((m) => m.seat === s).length;
      a.calls += st.calls ?? 0;
      a.subs += st.subs ?? 0;
      a.salvages += salvageBySeat[s] ?? 0;
      if (opening) a.openings.set(opening, (a.openings.get(opening) ?? 0) + 1);
      acc.set(p.id, a);
    });
  }
  return [...acc.values()].map((a) => {
    let topOpening = null;
    let topN = 0;
    for (const [k, n] of a.openings) if (n > topN) { topN = n; topOpening = k; }
    const { openings, ...rest } = a;
    return { ...rest, avgMs: a.steps > 0 ? Math.round(a.ms / a.steps) : 0, topOpening };
  });
}

/** 跨局开局记忆（P2 #4）：每局终局把「前 12 着记谱 + 胜负」按
 *  `${playerId}|${gameId}|${seat}` 归档——下局开局阶段注入「你用此开局 n 胜
 *  m 负」，模型级经验积累（不训练的自我进化）。纯函数（可测）。 */
export function applyOpenings(doc, record) {
  const next = JSON.parse(JSON.stringify(doc ?? {}));
  const moves = (record.events ?? []).filter((e) => e.t === "move");
  if (moves.length === 0) return next;
  const openingKey = moves.slice(0, 12).map((e) => e.detail?.zh ?? e.move).join(" ");
  const best = Math.min(...(record.ranks ?? [0]));
  (record.players ?? []).forEach((p, s) => {
    if (p.kind !== "llm") return;
    const key = `${p.id}|${record.gameId}|${s}`;
    const entry = next[key] ?? {};
    const cur = entry[openingKey] ?? { w: 0, d: 0, l: 0 };
    const ranks = record.ranks ?? [];
    if (record.draw || ranks.every((r) => r === ranks[s])) cur.d += 1;
    else if (ranks[s] === best) cur.w += 1;
    else cur.l += 1;
    entry[openingKey] = cur;
    next[key] = entry;
  });
  return next;
}

export async function loadOpenings() {
  const doc = await loadData("arena_openings");
  return doc && typeof doc === "object" ? doc : {};
}

/** 天梯视图：单游戏榜（按 expose 排序）+ 加权总榜（局数加权 expose 均值）。 */
export function ladderView(ratingsDoc, gameId) {
  const table = ratingsDoc?.[gameId] ?? {};
  const rows = Object.entries(table)
    .map(([id, r]) => ({ id, ...r, rating: expose(r), tier: tierOf(r) }))
    .sort((a, b) => b.rating - a.rating);
  return rows;
}

export function overallLadder(ratingsDoc) {
  const acc = new Map();
  for (const table of Object.values(ratingsDoc ?? {})) {
    if (!table || typeof table !== "object") continue; // 调试残留等非表字段跳过
    for (const [id, r] of Object.entries(table)) {
      const cur = acc.get(id) ?? { id, sum: 0, played: 0, muSum: 0, wins: 0, draws: 0, losses: 0, subs: 0 };
      cur.sum += expose(r) * r.played;
      cur.played += r.played;
      cur.muSum += r.mu * r.played;
      cur.wins += r.wins ?? 0;
      cur.draws += r.draws ?? 0;
      cur.losses += r.losses ?? 0;
      cur.subs += r.subs ?? 0;
      acc.set(id, cur);
    }
  }
  return [...acc.values()]
    .filter((x) => x.played > 0)
    .map((x) => {
      const r = { mu: x.muSum / x.played, sigma: 25 / 3 };
      // 总榜聚合口径：战绩跨游戏求和；σ 是聚合伪值，UI 显示 '-'
      return { id: x.id, played: x.played, rating: x.sum / x.played, tier: tierOf(r), mu: r.mu, sigma: null, wins: x.wins, draws: x.draws, losses: x.losses, subs: x.subs };
    })
    .sort((a, b) => b.rating - a.rating);
}
