/**
 * 模型配置面（共识 §二#3/#14）：厂商全列四分组卡、key/baseUrl/模型手填、
 * 常用模型预设 chips、测试连接（经网关 /v1/models）。key 明文落 userData
 * config.json（预留 encrypted:// 前缀升级位）。
 */
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/index.jsx";
import VendorLogo from "../components/VendorLogo.jsx";
import { VENDOR_BY_ID, catalogByGroup, readModelConfig, saveModelConfig, testVendorConnection } from "./store.js";

/** 常用模型预设（手填起步模板；其余手填）。 */
const PRESETS = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  zhipu: ["glm-4.7", "glm-4.7-flash"],
  moonshot: ["kimi-k2.5", "moonshot-v1-32k"],
  "aliyun-bailian": ["qwen3-max", "qwen3-turbo"],
  openai: ["gpt-5.2", "gpt-5-mini"],
  anthropic: ["claude-sonnet-4.6"],
  gemini: ["gemini-3-flash", "gemini-3-pro"],
  ollama: ["qwen3:32b"],
  openrouter: ["openrouter/auto"],
  siliconflow: ["Qwen/Qwen3-32B"],
};

function VendorCard({ entry, onSave, onRemove }) {
  const { t } = useI18n();
  const v = VENDOR_BY_ID.get(entry.id);
  const [key, setKey] = useState(entry.key ?? "");
  const [baseUrl, setBaseUrl] = useState(entry.baseUrl ?? v?.defaultUrl ?? "");
  const [modelsText, setModelsText] = useState((entry.models ?? []).join(", "));
  const [test, setTest] = useState(null); // { ok, msg } | "busy"
  const dirty = key !== (entry.key ?? "") || baseUrl !== (entry.baseUrl ?? "") || modelsText !== (entry.models ?? []).join(", ");
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2" data-vendor-card={entry.id}>
      <div className="flex items-center gap-2">
        <VendorLogo logo={v?.logo} name={v?.name ?? entry.id} size={22} />
        <span className="text-xs font-semibold flex-1 truncate">{v?.name ?? entry.id}</span>
        {v?.free && v.free !== "nokey" && <span className="px-1 rounded bg-emerald-500/15 text-emerald-400 text-[10px]">{v.free === "freekey" ? "免费Key" : "免费额度"}</span>}
        {v?.ollamaLike && <span className="px-1 rounded bg-sky-500/15 text-sky-400 text-[10px]">本地</span>}
        <button className="text-[11px] opacity-60 hover:opacity-100" onClick={() => window.open(v?.keyUrl, "_blank")} disabled={!v?.keyUrl}>取 Key ↗</button>
        <button
          className="px-2 py-0.5 rounded-lg text-[11px] bg-white/5 hover:bg-white/10"
          onClick={async () => { setTest("busy"); setTest(await testVendorConnection(entry.id)); }}
          data-vendor-test={entry.id}
        >
          {test === "busy" ? "…" : t("arena.settings.test")}
        </button>
        <button className="text-[11px] text-red-400 opacity-70 hover:opacity-100" onClick={() => onRemove(entry.id)} data-vendor-remove={entry.id}>移除</button>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <label className="opacity-60 w-16 shrink-0">API Key</label>
        <input className="flex-1 bg-black/40 rounded-lg px-2 py-1 font-mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" data-vendor-key={entry.id} />
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <label className="opacity-60 w-16 shrink-0">Base URL</label>
        <input className="flex-1 bg-black/40 rounded-lg px-2 py-1 font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={v?.defaultUrl || "https://…/v1"} data-vendor-baseurl={entry.id} />
      </div>
      <div className="flex items-start gap-2 text-[11px]">
        <label className="opacity-60 w-16 shrink-0 pt-1.5">模型</label>
        <div className="flex-1 flex flex-col gap-1.5">
          <input className="w-full bg-black/40 rounded-lg px-2 py-1 font-mono" value={modelsText} onChange={(e) => setModelsText(e.target.value)} placeholder="逗号分隔，如 deepseek-chat, deepseek-reasoner" data-vendor-models={entry.id} />
          {(PRESETS[entry.id] ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1" data-vendor-presets={entry.id}>
              {PRESETS[entry.id].filter((m) => !modelsText.includes(m)).map((m) => (
                <button key={m} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 font-mono text-[10px] opacity-80" onClick={() => setModelsText(modelsText ? `${modelsText.trimEnd()}, ${m}` : m)}>+ {m}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[10px]">{test && test !== "busy" && <span className={test.ok ? "text-emerald-400" : "text-red-400"}>{test.msg}</span>}</span>
        <button
          className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-500 text-white disabled:opacity-40"
          disabled={!dirty}
          onClick={() => onSave(entry.id, { ...entry, key: key.trim(), baseUrl: baseUrl.trim(), models: modelsText.split(/[,，]/).map((x) => x.trim()).filter(Boolean), enabled: true })}
          data-vendor-save={entry.id}
        >
          {t("arena.settings.save")}
        </button>
      </div>
    </div>
  );
}

export default function ModelSettings() {
  const { t } = useI18n();
  const [config, setConfig] = useState({ vendors: [] });
  const [groupFilter, setGroupFilter] = useState("cn");
  const [catalogQuery, setCatalogQuery] = useState("");
  const groups = useMemo(() => catalogByGroup(), []);
  const reload = () => void readModelConfig().then(setConfig);
  useEffect(reload, []);
  const configured = new Set(config.vendors.map((v) => v.id));
  const addVendor = (id) => { void saveModelConfig([...config.vendors, { id, key: "", baseUrl: VENDOR_BY_ID.get(id)?.defaultUrl ?? "", models: [], enabled: true }]).then(reload); };
  const removeVendor = (id) => { void saveModelConfig(config.vendors.filter((v) => v.id !== id)).then(reload); };
  const saveVendor = (id, next) => { void saveModelConfig(config.vendors.map((v) => (v.id === id ? next : v))).then(reload); };
  const filtered = (groups.find((g) => g.id === groupFilter)?.vendors ?? []).filter((v) => !catalogQuery || v.name.toLowerCase().includes(catalogQuery.toLowerCase()) || v.id.includes(catalogQuery.toLowerCase()));
  return (
    <div className="h-full overflow-y-auto p-5" data-model-settings>
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold flex-1">{t("arena.settings.title")}</h2>
          <span className="text-[11px] opacity-50">{t("arena.settings.count", { n: config.vendors.length })}</span>
        </div>
        {config.vendors.length > 0 && (
          <div className="flex flex-col gap-3" data-configured-vendors>
            {config.vendors.map((v) => <VendorCard key={v.id} entry={v} onSave={saveVendor} onRemove={removeVendor} />)}
            <p className="text-[10px] opacity-40">{t("arena.settings.keyNote")}</p>
          </div>
        )}
        {config.vendors.length === 0 && <p className="text-xs opacity-50 py-4 text-center">{t("arena.settings.empty")}</p>}
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold">{t("arena.settings.catalog")}</h3>
          <input className="flex-1 max-w-52 bg-black/40 rounded-lg px-2 py-1 text-[11px]" placeholder={t("arena.settings.search")} value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5 text-xs" data-catalog-groups>
          {groups.map((g) => (
            <button key={g.id} className={`px-2.5 py-1 rounded-lg ${groupFilter === g.id ? "bg-blue-500 text-white" : "bg-white/5 opacity-70 hover:opacity-100"}`} onClick={() => setGroupFilter(g.id)}>{t(`arena.settings.group.${g.id}`)}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2" data-catalog-grid>
          {filtered.map((v) => (
            <button
              key={v.id}
              className="flex items-center gap-2 rounded-xl border border-white/10 p-2.5 text-left hover:border-blue-500/50 disabled:opacity-30"
              onClick={() => addVendor(v.id)}
              disabled={configured.has(v.id)}
              data-catalog-vendor={v.id}
            >
              <VendorLogo logo={v.logo} name={v.name} size={24} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium truncate">{v.name}</span>
                <span className="block text-[10px] opacity-50 truncate">{v.defaultUrl || v.id}</span>
              </span>
              {v.free === "nokey" && <span className="text-[10px] text-sky-400">免Key</span>}
              {v.free === "freekey" && <span className="text-[10px] text-emerald-400">免费Key</span>}
              {v.free === "tier" && <span className="text-[10px] text-amber-400">免费额度</span>}
              {configured.has(v.id) && <span className="text-[10px] opacity-50">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
