/**
 * 天梯榜（games-llm-arena-plan Q7）：分游戏主榜（TrueSkill μ±σ → 段位）+
 * 加权总榜（「本地模型智力总榜」口径：各游戏 expose 局数加权）+ 人类挑战者
 * 战绩单列（人机不计模型 rating 的补充裁定）。
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { getGames } from "../../arena/registry.js";
import { ladderView, overallLadder, modelStatsFromRecords } from "../../arena/storage.js";
import { TIERS } from "../../arena/trueskill.js";
import { useI18n } from "../../i18n/index.jsx";

/** 模型卡片（P1 #8）：行点击展开——步均耗时/代走/回捞/调用/常用开局，
 *  数据从棋谱全量记录聚合（storage.modelStatsFromRecords 纯函数）。 */
function ModelCard({ stat, t }) {
  const fmtS = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  const items = [
    [t("arena.modelcard.games"), stat.games],
    [t("arena.modelcard.wins"), stat.wins],
    [t("arena.modelcard.avgMs"), fmtS(stat.avgMs)],
    [t("arena.modelcard.calls"), stat.calls],
    [t("arena.modelcard.subs"), stat.subs],
    [t("arena.modelcard.salvages"), stat.salvages],
  ];
  return (
    <tr className="border-t border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.03]" data-arena-model-card={stat.id}>
      <td colSpan={7} className="px-3 py-2">
        <div className="flex items-center gap-4 flex-wrap text-[11px] opacity-80">
          {items.map(([k, v]) => (
            <span key={k} className="flex items-center gap-1"><span className="opacity-55">{k}</span><span className="font-mono">{v}</span></span>
          ))}
        </div>
        {stat.topOpening && (
          <div className="mt-1 text-[11px] opacity-60 truncate" title={stat.topOpening} data-arena-model-opening>
            {t("arena.modelcard.opening")}：{stat.topOpening}
          </div>
        )}
      </td>
    </tr>
  );
}

function TierBadge({ tier }) {
  return <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: `${tier.color}22`, color: tier.color }}>{tier.name}</span>;
}

export default function Ladder({ loader }) {
  const { t } = useI18n();
  const games = useMemo(() => getGames(), []);
  const [gameId, setGameId] = useState("__overall__");
  const [ratings, setRatings] = useState({});
  const [humans, setHumans] = useState({});
  const [modelStats, setModelStats] = useState([]);
  const [openCard, setOpenCard] = useState(null);
  const [ready, setReady] = useState(false);

  const reload = () => {
    setReady(false);
    const loads = [loader.loadRatings(), loader.loadHumans()];
    // 模型卡片数据源（棋谱全量记录；通道缺席静默跳过）
    if (typeof loader.loadRecords === "function") {
      loads.push(loader.loadRecords().then((recs) => modelStatsFromRecords(recs)).catch(() => []));
    } else {
      loads.push(Promise.resolve([]));
    }
    Promise.all(loads)
      .then(([r, h, ms]) => { setRatings(r ?? {}); setHumans(h ?? {}); setModelStats(ms ?? []); setReady(true); })
      .catch(() => setReady(true));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = gameId === "__overall__" ? overallLadder(ratings) : ladderView(ratings, gameId);
  const humanRows = Object.entries(humans);

  return (
    <div className="h-full overflow-y-auto p-5" data-arena-ladder>
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div className="flex gap-2 flex-wrap items-center" data-arena-ladder-tabs>
          <button
            className={`px-3 py-1.5 rounded-lg text-xs ${gameId === "__overall__" ? "bg-blue-500 text-white" : "bg-black/5 dark:bg-white/10"}`}
            onClick={() => setGameId("__overall__")}
            data-arena-ladder-tab="__overall__"
          >{t("arena.ladder.overall")}</button>
          {games.map((g) => (
            <button
              key={g.id}
              className={`px-3 py-1.5 rounded-lg text-xs ${gameId === g.id ? "bg-blue-500 text-white" : "bg-black/5 dark:bg-white/10"}`}
              onClick={() => setGameId(g.id)}
              data-arena-ladder-tab={g.id}
            >{g.label}</button>
          ))}
          <div className="flex-1" />
          <button className="text-xs opacity-60 hover:opacity-100" onClick={reload}>{t("arena.ladder.refresh")}</button>
          <button
            className="text-xs text-red-500/80 hover:text-red-500"
            data-arena-ladder-reset
            onClick={async () => {
              if (!window.confirm(t("arena.ladder.resetConfirm"))) return;
              const { resetRatings } = await import("../../arena/storage.js");
              await resetRatings();
              reload();
            }}
          >{t("arena.ladder.reset")}</button>
        </div>

        <div className="rounded-2xl border border-black/8 dark:border-white/10 overflow-hidden" data-arena-ladder-table>
          <table className="w-full text-xs">
            <thead className="bg-black/[0.03] dark:bg-white/5">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">{t("arena.ladder.player")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("arena.ladder.tier")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("arena.ladder.rating")}</th>
                <th className="px-3 py-2 text-right font-medium">μ±σ</th>
                <th className="px-3 py-2 text-right font-medium">{t("arena.ladder.record")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("arena.ladder.subs")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center opacity-50">{ready ? t("arena.ladder.empty") : "…"}</td></tr>
              )}
              {rows.map((r, i) => {
                const card = modelStats.find((m) => m.id === r.id) ?? null;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-t border-black/5 dark:border-white/5 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
                      data-arena-ladder-row={r.id}
                      onClick={() => setOpenCard((v) => (v === r.id ? null : r.id))}
                      title={card ? t("arena.modelcard.expandTip") : undefined}
                    >
                      <td className="px-3 py-2 opacity-60">{i + 1}</td>
                      <td className="px-3 py-2 font-medium truncate max-w-52" title={r.id}>{r.id.split("/").pop()}{r.id.startsWith("local/") ? "" : " ☁"}</td>
                      <td className="px-3 py-2"><TierBadge tier={r.tier} /></td>
                      <td className="px-3 py-2 text-right font-mono">{r.rating.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right font-mono opacity-60">{(r.mu ?? r.rating).toFixed(1)}{r.sigma == null ? "" : `±${r.sigma.toFixed(1)}`}</td>
                      <td className="px-3 py-2 text-right opacity-70">{r.wins ?? 0}-{r.draws ?? 0}-{r.losses ?? 0}</td>
                      <td className="px-3 py-2 text-right text-amber-500">{r.subs ?? 0}</td>
                    </tr>
                    {openCard === r.id && card && <ModelCard stat={card} t={t} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 人类挑战者战绩（单列，不进模型榜） */}
        <section>
          <h3 className="text-sm font-semibold mb-2">{t("arena.ladder.humans")}</h3>
          <p className="text-[11px] opacity-60 mb-2">{t("arena.ladder.humansNote")}</p>
          {humanRows.length === 0 && <div className="text-xs opacity-50">{t("arena.ladder.empty")}</div>}
          {humanRows.map(([id, h]) => (
            <div key={id} className="rounded-2xl border border-black/8 dark:border-white/10 p-3 mb-2 text-xs" data-arena-human-row={id}>
              <div className="font-medium mb-1">👤 {h.name ?? id}</div>
              {Object.entries(h.games ?? {}).map(([gid, g]) => (
                <div key={gid} className="flex items-center gap-3 flex-wrap opacity-80">
                  <span>{getGames().find((x) => x.id === gid)?.label ?? gid}</span>
                  <span className="font-mono">{g.wins}胜 {g.draws}平 {g.losses}负</span>
                  <span className="opacity-60">
                    {Object.entries(g.vs ?? {}).map(([, v]) => `${v.model}: ${t("arena.ladder.wl", { w: v.wins, l: v.losses })}`).join("；")}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>

        {/* 段位说明 */}
        <div className="text-[11px] opacity-50 flex gap-2 flex-wrap">
          {TIERS.map((x) => <span key={x.name} className="flex items-center gap-1"><TierBadge tier={x} />{x.min > -1e8 ? `≥${x.min}` : ""}</span>)}
          <span className="ml-2">{t("arena.ladder.tierNote")}</span>
        </div>
      </div>
    </div>
  );
}
