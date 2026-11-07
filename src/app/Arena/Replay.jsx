/**
 * 回放室（games-llm-arena-plan Q5 五件套之五 + Q9 一期口径）：时间轴 +
 * 逐步回放 + 代走标注 + 每步耗时/调用量曲线（数据对局时免费产生）。
 * LLM 赛后解说按 Q9 留二期（协议 {move,comment} 已既定，comment 弹幕即存档）。
 */
import { useEffect, useMemo, useState } from "react";
import { getGames } from "../../arena/registry.js";
import { GamePanel } from "./boards.jsx";
import { downloadJson } from "./Records.jsx";
import { useI18n } from "../../i18n/index.jsx";

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export default function Replay({ record }) {
  const { t } = useI18n();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const moves = useMemo(() => (record?.events ?? []).filter((e) => e.t === "move"), [record]);
  const snaps = record?.snapshots ?? [];
  // 快照 idx → 对齐 move 序号；代走/耗时曲线用 moves
  // 键盘导航（←→ 步进 / 空格播放）——回放室对齐市面播放器交互
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") { setPlaying(false); setIdx((i) => Math.min(i + 1, Math.max(0, snaps.length - 1))); }
      else if (e.key === "ArrowLeft") { setPlaying(false); setIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snaps.length]);
  const cur = snaps[Math.min(idx, snaps.length - 1)] ?? null;
  const curMove = moves[Math.min(idx, moves.length - 1)] ?? null;
  const maxMs = Math.max(1, ...moves.map((m) => m.ms ?? 0));
  // games2 Q11：形势领先度序列（scored 游戏的 move 事件带 scores；取 0 号位视角，
  // 多人游戏取「0 号 - 其余最大」，观战呈现专用不进模型观察）
  const leadSeries = useMemo(() => moves.map((m) => {
    if (!Array.isArray(m.scores) || m.scores.length < 2) return null;
    const me = m.scores[0];
    const foe = Math.max(...m.scores.slice(1));
    return me - foe;
  }).filter((v) => v != null), [moves]);
  const leadMax = Math.max(1, ...leadSeries.map((v) => Math.abs(v)));

  // 自动播放（800ms/步）
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setIdx((i) => {
        if (i >= snaps.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 800);
    return () => clearInterval(timer);
  }, [playing, snaps.length]);

  if (!record) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-sm opacity-60" data-arena-replay-empty>
        <div className="text-3xl">🎬</div>
        <div>{t("arena.replay.empty")}</div>
      </div>
    );
  }
  const gameDef = getGames().find((g) => g.id === record.gameId);

  return (
    <div className="h-full flex flex-col min-h-0" data-arena-replay>
      <div className="px-4 py-2 text-xs flex items-center gap-2 border-b border-black/5 dark:border-white/10 shrink-0">
        <span className="font-semibold">{gameDef?.label ?? record.gameId} · {t("arena.replay.title")}</span>
        {record.gameOpts?.revealAll && <span className="px-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px]" title={t("arena.records.revealTip")}>{t("arena.records.revealBadge")}</span>}
        <span className="opacity-60 truncate">{record.summary}</span>
        <span className="flex-1" />
        <button className="px-2 py-0.5 rounded-lg bg-black/5 dark:bg-white/10 opacity-60 hover:opacity-100" onClick={() => downloadJson(record, `arena-${record.gameId}-${record.id}.json`)} data-arena-replay-export>
          ⬇ {t("arena.replay.export")}
        </button>
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col p-4 gap-3 overflow-auto">
          <div className="flex-1 min-h-[260px]">
            {cur?.state && (
              <GamePanel
                gameId={record.gameId}
                state={cur.state}
                seatNames={(record.players ?? []).map((p, i) => `${record.players?.[i]?.label ?? `玩家${i + 1}`}`)}
                lastMove={curMove}
                replay
              />
            )}
            {snaps.length === 0 && <div className="text-xs opacity-50 p-6 text-center">{t("arena.replay.noSnap")}</div>}
          </div>
          {/* 当前步信息 */}
          <div className="text-xs flex items-center gap-3 flex-wrap" data-arena-replay-cur>
            {curMove ? (
              <>
                <span className="font-medium">{(record.players ?? [])[curMove.seat]?.label ?? "?"}</span>
                <span className="font-mono">{curMove.move}</span>
                {curMove.substituted && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px]">{t("arena.replay.subbed")}</span>}
                <span className="opacity-50">{fmtMs(curMove.ms ?? 0)}</span>
                {curMove.usage && <span className="opacity-50">{curMove.usage.pt}→{curMove.usage.ct} tok</span>}
                {typeof curMove.swing === "number" && (
                  <span
                    className={`font-bold ${curMove.swing >= 150 ? "text-emerald-500" : curMove.swing <= -150 ? "text-red-500" : "opacity-50"}`}
                    title={t("arena.replay.swingTip", { v: curMove.swing })}
                    data-arena-replay-mark
                  >{curMove.swing >= 400 ? "!!" : curMove.swing >= 150 ? "!?" : curMove.swing <= -400 ? "??" : curMove.swing <= -150 ? "?" : "→"}</span>
                )}
                {curMove.comment && <span className="opacity-70">💬 {curMove.comment}</span>}
              </>
            ) : <span className="opacity-50">{t("arena.replay.start")}</span>}
          </div>
          {/* Q10：思维链正文（思考气泡，cot 局才有） */}
          {curMove?.think && (
            <details className="text-[11px] opacity-75" data-arena-replay-think>
              <summary className="cursor-pointer select-none list-none">💭 {t("arena.feed.think")}</summary>
              <div className="mt-1 px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/5 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">{curMove.think}</div>
            </details>
          )}
          {/* games2 Q11：形势领先度曲线（scored 游戏 move 事件带 scores；对齐 OGS「分差曲线比胜率直观」实锤口径） */}
          {leadSeries.length > 1 && (
            <div className="px-1" data-arena-replay-lead>
              <div className="flex items-center justify-between text-[10px] opacity-60">
                <span>{t("arena.replay.lead")}</span>
                <span>{(record.players ?? [])[0]?.label ?? "P1"} ↔ {(record.players ?? [])[1]?.label ?? "P2"}</span>
              </div>
              <svg viewBox={`0 0 ${Math.max(leadSeries.length - 1, 1)} 40`} preserveAspectRatio="none" className="w-full h-14">
                <rect x="0" y="0" width={Math.max(leadSeries.length - 1, 1)} height="40" fill="url(#leadGrad)" opacity="0.5" />
                <defs>
                  <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f8cff" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#888" stopOpacity="0.05" />
                    <stop offset="100%" stopColor="#e05555" stopOpacity="0.8" />
                  </linearGradient>
                </defs>
                <polyline
                  points={leadSeries.map((v, i) => `${i},${20 - Math.max(-19, Math.min(19, v / leadMax * 19))}`).join(" ")}
                  fill="none" stroke="#7a5321" strokeWidth="0.8"
                />
                <line x1="0" y1="20" x2={Math.max(leadSeries.length - 1, 1)} y2="20" stroke="#7a5321" strokeWidth="0.3" strokeDasharray="2 2" opacity="0.6" />
              </svg>
            </div>
          )}
          {/* 每步耗时/调用量曲线 */}
          <div className="flex items-end gap-[2px] h-12 px-1" data-arena-replay-chart>
            {moves.map((m, i) => (
              <div
                key={i}
                className={`flex-1 min-w-[2px] rounded-t cursor-pointer ${m.substituted ? "bg-amber-400" : i === Math.min(idx, moves.length - 1) ? "bg-blue-500" : "bg-black/20 dark:bg-white/20"}`}
                style={{ height: `${Math.max(6, ((m.ms ?? 0) / maxMs) * 100)}%` }}
                title={`${(record.players ?? [])[m.seat]?.label ?? m.seat} · ${m.move} · ${fmtMs(m.ms ?? 0)}${m.substituted ? ` · ${t("arena.replay.subbed")}` : ""}`}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
          {/* 时间轴 */}
          <div className="flex items-center gap-3" data-arena-replay-slider>
            <button className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/10 text-sm" onClick={() => setIdx(0)}>⏮</button>
            <button className="w-8 h-8 rounded-lg bg-blue-500 text-white text-sm" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</button>
            <input
              type="range" min={0} max={Math.max(0, snaps.length - 1)} value={Math.min(idx, snaps.length - 1)}
              onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
              className="flex-1"
            />
            <span className="text-xs opacity-60 font-mono w-20 text-right">{snaps.length ? Math.min(idx, snaps.length - 1) + 1 : 0}/{snaps.length}</span>
          </div>
        </div>
        {/* 右：整局棋谱（含 reject 与弹幕全文） */}
        <div className="w-72 shrink-0 border-l border-black/5 dark:border-white/10 overflow-y-auto arena-feed px-3 py-2 text-xs flex flex-col gap-1.5">
          {(record.events ?? []).filter((e) => e.t === "move" || e.t === "reject").map((e, i) => (
            e.t === "reject"
              ? <div key={i} className="text-[11px] text-amber-600 dark:text-amber-400">⚠️ {String(e.reason).slice(0, 70)}</div>
              : (
                <div key={i} className={`px-1.5 py-0.5 rounded ${i === idx ? "bg-blue-500/15" : ""}`}>
                  <span className="opacity-60">{(record.players ?? [])[e.seat]?.label?.[0] ?? "?"}</span>{" "}
                  <span className="font-mono">{e.move}</span>
                  {e.substituted && <span className="text-amber-500 text-[10px]"> 代走</span>}
                  {e.comment && <div className="text-[10px] opacity-60 truncate" title={e.comment}>💬 {e.comment}</div>}
                </div>
              )
          ))}
        </div>
      </div>
    </div>
  );
}
