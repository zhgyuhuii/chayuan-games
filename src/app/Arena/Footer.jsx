/**
 * 察元家族页脚（五件套共用——壳层一处渲染，大厅/对局室/天梯榜/对局记录/回放全覆盖）。
 * 出品方 + 家族应用 + GitHub 点赞 + 公众号二维码（hover 弹出，图源察元AI OS qr-follow）。
 * 外链统一 window.open 新窗（与设置页「取 Key ↗」同款，Electron 默认行为一致）。
 */
import { useI18n } from "../../i18n/index.jsx";
import qrFollow from "../../assets/qr-follow.png";

/** 公开仓库与官方入口（2026-11-07 实测：harness/website 仓私有 → 官网兜底） */
const LINKS = {
  plaza: "https://aidooo.com/",
  os: "https://aidooo.com/",
  office: "https://github.com/zhgyuhuii/ChayuanAIOffice",
  wps: "https://github.com/zhgyuhuii/chayuan",
  desk: "https://aidooo.com/",
  starArena: "https://github.com/zhgyuhuii/chayuan-games",
};

const open = (url) => () => window.open(url, "_blank", "noopener");

function FootLink({ label, url, title }) {
  return (
    <button
      className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      onClick={open(url)}
      title={title}
      data-arena-footer-link={url}
    >
      {label}
    </button>
  );
}

export default function ArenaFooter() {
  const { t } = useI18n();
  return (
    <footer
      className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-t border-black/5 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] text-[11px] text-gray-500 dark:text-gray-400 select-none"
      data-arena-footer
    >
      <span>{t("arena.footer.producer")}</span>
      <span className="opacity-30">·</span>
      <span className="flex items-center gap-2.5 flex-wrap">
        <span className="opacity-60">{t("arena.footer.family")}</span>
        <FootLink label={t("arena.footer.family.plaza")} url={LINKS.plaza} title="aidooo.com" />
        <FootLink label={t("arena.footer.family.os")} url={LINKS.os} title={t("arena.footer.osTip")} />
        <FootLink label={t("arena.footer.family.office")} url={LINKS.office} />
        <FootLink label={t("arena.footer.family.wps")} url={LINKS.wps} />
        <FootLink label={t("arena.footer.family.desk")} url={LINKS.desk} title={t("arena.footer.deskTip")} />
      </span>
      <span className="opacity-30">·</span>
      <span className="flex items-center gap-2.5 flex-wrap">
        <span className="opacity-60">GitHub ★</span>
        <FootLink label={t("arena.footer.starArena")} url={LINKS.starArena} title={t("arena.footer.star")} />
        <FootLink label={t("arena.footer.starOffice")} url={LINKS.office} title={t("arena.footer.star")} />
        <FootLink label={t("arena.footer.starWps")} url={LINKS.wps} title={t("arena.footer.star")} />
      </span>
      <span className="flex-1" />
      <span className="relative group flex items-center gap-1.5" data-arena-follow>
        <button className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-black/10 dark:border-white/15 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
          {t("arena.footer.follow")}
        </button>
        <span className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover:flex flex-col items-center gap-1 z-50">
          <img
            src={qrFollow}
            alt="Chayuan AI WeChat"
            className="w-28 h-28 rounded-lg bg-white p-1 shadow-lg border border-black/10 dark:border-white/20"
          />
          <span className="whitespace-nowrap px-2 py-0.5 rounded bg-black/80 text-white text-[10px]">
            {t("arena.footer.followTip")}
          </span>
        </span>
      </span>
    </footer>
  );
}
