/**
 * 对局记录（games-llm-arena-plan Q5 五件套之四）：JSON 事件流棋谱列表——
 * 游戏/对阵（匿名局已揭晓）/结果/代走次数/时长/调用量，点击进回放。
 * 2026-11-07 补齐欠账：协议筛选（Q13「回放列表可按协议筛选」承诺落地——
 * 比对同模型开关思维链的棋力差）+ 棋谱导出（Q13「内容资产」定位的落盘出口：
 * 单局/全部 JSON 下载，80 条滚动 cap 不再是资产终点）。
 */
import { useEffect, useState } from "react";
import { getGames } from "../../arena/registry.js";
import { useI18n } from "../../i18n/index.jsx";

const fmtDur = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(0)}s`);
const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const GAME_ICONS = {
  gobang: "⚫", xiangqi: "♟️", doudizhu: "🃏", mahjong: "🀄",
  "mahjong-xueliu": "🩸", "mahjong-guangdong": "🀙", "mahjong-riichi": "🎴",
  junqi: "🎖️", fanqi: "🎴", poker: "♠️", guandan: "🂡", go9: " ⚫", go13: "⚫",
};

/** 棋谱 JSON 下载（content asset 落盘出口；Electron renderer 走默认下载目录）。 */
export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export default function Records({ loader, onReplay }) {
  const { t } = useI18n();
  const [records, setRecords] = useState(null);
  const [proto, setProto] = useState("all"); // all | cot | bare（Q13 协议分桶筛选）

  const reload = () => { loader.loadRecords().then((l) => setRecords(l)).catch(() => setRecords([])); };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (records ?? []).filter((r) => (proto === "all" ? true : r.protocol === proto));

  return (
    <div className="h-full overflow-y-auto p-5" data-arena-records>
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold flex-1">{t("arena.records.title")}</h2>
          <button className="text-xs opacity-60 hover:opacity-100" onClick={() => shown.length && downloadJson(shown, `arena-records-${stamp()}.json`)} data-arena-records-exportall>
            {t("arena.records.exportAll")}
          </button>
          <button className="text-xs opacity-60 hover:opacity-100" onClick={reload}>{t("arena.ladder.refresh")}</button>
        </div>
        <div className="flex items-center gap-1.5 text-xs" data-arena-records-protofilter>
          {[["all", t("arena.records.filterAll")], ["cot", t("arena.records.filterCot")], ["bare", t("arena.records.filterBare")]].map(([id, label]) => (
            <button
              key={id}
              className={`px-2.5 py-1 rounded-lg ${proto === id ? "bg-blue-500 text-white" : "bg-black/5 dark:bg-white/10 opacity-70 hover:opacity-100"}`}
              onClick={() => setProto(id)}
              data-arena-records-proto={id}
            >
              {label}
            </button>
          ))}
        </div>
        {records === null && <div className="text-xs opacity-50">…</div>}
        {records?.length === 0 && <div className="text-xs opacity-50 py-8 text-center">{t("arena.records.empty")}</div>}
        {records?.length > 0 && shown.length === 0 && <div className="text-xs opacity-50 py-8 text-center">{t("arena.records.filterEmpty")}</div>}
        {shown.map((r) => {
          const gameDef = getGames().find((g) => g.id === r.gameId);
          const subs = (r.stats ?? []).reduce((s, x) => s + (x?.subs ?? 0), 0);
          const calls = (r.stats ?? []).reduce((s, x) => s + (x?.calls ?? 0), 0);
          return (
            <div
              key={r.id}
              className="text-left rounded-2xl border border-black/8 dark:border-white/10 p-3 hover:border-blue-500/50 transition-colors flex items-center gap-3 cursor-pointer"
              onClick={() => onReplay(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") onReplay(r); }}
              data-arena-record={r.id}
            >
              <span className="text-xl">{GAME_ICONS[r.gameId] ?? "🎮"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {gameDef?.label ?? r.gameId} · {r.mode === "human_vs_ai" ? t("arena.mode.human") : t("arena.mode.watch")} · {fmtTime(r.startedAt)}
                  {r.protocol === "cot" && <span className="ml-1 px-1 rounded bg-violet-500/15 text-violet-600 dark:text-violet-400 text-[10px]" title={t("arena.records.cotTip")}>💭CoT</span>}
                  {r.gameOpts?.revealAll && <span className="ml-1 px-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px]" title={t("arena.records.revealTip")}>{t("arena.records.revealBadge")}</span>}
                </div>
                <div className="text-[11px] opacity-60 truncate">{r.summary}</div>
                <div className="text-[11px] opacity-60 truncate">
                  {(r.players ?? []).map((p) => p.label + (p.cloud ? "☁" : "")).join(" vs ")}
                </div>
              </div>
              <div className="text-right text-[11px] opacity-70 shrink-0">
                <div>{t("arena.records.dur")} {fmtDur(r.durationMs ?? 0)}</div>
                <div>{t("arena.records.calls")} {calls}</div>
                {subs > 0 && <div className="text-amber-500">{t("arena.records.subs")} {subs}</div>}
              </div>
              <button
                className="shrink-0 w-7 h-7 rounded-lg text-xs bg-black/5 dark:bg-white/10 opacity-60 hover:opacity-100"
                title={t("arena.records.exportOne")}
                onClick={(e) => { e.stopPropagation(); downloadJson(r, `arena-${r.gameId}-${r.id}.json`); }}
                data-arena-records-export={r.id}
              >
                ⬇
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
