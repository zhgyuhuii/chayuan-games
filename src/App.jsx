import { useState } from "react";
import { useI18n } from "./i18n/index.jsx";
import Arena from "./app/Arena/index.jsx";
import ModelSettings from "./settings/ModelSettings.jsx";

/** 单窗口两顶层：竞技场（五件套内部自管导航）+ 模型配置（共识 §二#1/#14）。 */
export default function App() {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState("arena");
  return (
    <div className="h-full flex flex-col bg-[#171a21] text-[#e8eaf0]" data-cg-app>
      <header className="flex items-center gap-2 px-4 py-2 border-b border-white/10 shrink-0">
        <span className="font-semibold text-sm">🎮 {t("arena.app.title")}</span>
        <span className="flex-1" />
        <nav className="flex items-center gap-1" data-cg-tabs>
          <button
            className={`px-3 py-1.5 rounded-lg text-xs ${tab === "arena" ? "bg-blue-500 text-white" : "bg-white/5 hover:bg-white/10 opacity-80"}`}
            onClick={() => setTab("arena")}
            data-cg-tab="arena"
          >
            {t("arena.tab.lobby")}
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-xs ${tab === "settings" ? "bg-blue-500 text-white" : "bg-white/5 hover:bg-white/10 opacity-80"}`}
            onClick={() => setTab("settings")}
            data-cg-tab="settings"
          >
            {t("arena.settings.tab")}
          </button>
        </nav>
        <button
          className="px-2 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10"
          onClick={() => setLang(lang === "zh" ? "en" : "zh")}
          data-cg-lang
        >
          {lang === "zh" ? "EN" : "中"}
        </button>
      </header>
      <main className="flex-1 min-h-0">
        {tab === "settings" ? <ModelSettings /> : <Arena />}
      </main>
    </div>
  );
}
