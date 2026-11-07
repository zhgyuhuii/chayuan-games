/**
 * 模型配置面（共识 §二#3/#14）：厂商全列四分组卡、自定义厂商弹窗（名称/ID/
 * baseUrl/协议/key → 卡片与目录厂商同链路）、key/baseUrl/模型手填、常用模型
 * 预设 chips、获取模型（经网关 POST /v1/models 实拉全列表勾选入库）、测试连接
 * （经网关 GET /v1/models）。key 明文落 userData config.json（预留
 * encrypted:// 前缀升级位）。
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/index.jsx";
import VendorLogo from "../components/VendorLogo.jsx";
import { VENDOR_BY_ID, VENDORS, catalogByGroup, fetchVendorModels, readModelConfig, saveModelConfig, testVendorConnection } from "./store.js";

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
  const vName = entry.name ?? v?.name ?? entry.id; // 自定义厂商显示所填名称
  const apiBase = entry.api ?? v?.api ?? "openai-completions";
  const [key, setKey] = useState(entry.key ?? "");
  const [baseUrl, setBaseUrl] = useState(entry.baseUrl ?? v?.defaultUrl ?? "");
  const [modelsText, setModelsText] = useState((entry.models ?? []).join(", "));
  const [api, setApi] = useState(apiBase); // 协议落盘后网关按条目 api 路由（anthropic-messages 走 x-api-key/messages 转换）
  const [test, setTest] = useState(null); // { ok, msg } | "busy"
  const [fetched, setFetched] = useState(null); // { ok, models?, msg } | "busy"
  const selected = useMemo(() => new Set(modelsText.split(/[,，]/).map((x) => x.trim()).filter(Boolean)), [modelsText]);
  const dirty = key !== (entry.key ?? "") || baseUrl !== (entry.baseUrl ?? "") || modelsText !== (entry.models ?? []).join(", ") || api !== apiBase;
  useEffect(() => { setFetched(null); }, [key, baseUrl]); // key/baseUrl 变更后旧拉取列表作废
  const doFetch = async () => { // 未保存的 key/baseUrl/api 直传网关实拉，不必先保存
    setFetched("busy");
    const r = await fetchVendorModels({ id: entry.id, baseUrl: baseUrl.trim(), key: key.trim(), api });
    setFetched(r.ok && (r.models?.length ?? 0) === 0 ? { ok: true, msg: t("arena.settings.noModels") } : r);
  };
  const toggleModel = (m) => {
    const list = modelsText.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    setModelsText((selected.has(m) ? list.filter((x) => x !== m) : [...list, m]).join(", "));
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2" data-vendor-card={entry.id}>
      <div className="flex items-center gap-2">
        <VendorLogo logo={v?.logo} name={vName} size={22} />
        <span className="text-xs font-semibold flex-1 truncate">{vName}</span>
        {entry.custom && <span className="px-1 rounded bg-violet-500/15 text-violet-400 text-[10px]">{t("arena.settings.customBadge")}</span>}
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
      {entry.custom && (
        <div className="flex items-center gap-2 text-[11px]">
          <label className="opacity-60 w-16 shrink-0">{t("arena.settings.protocol")}</label>
          <div className="flex gap-1" data-vendor-api={entry.id}>
            {[["openai-completions", t("arena.settings.protocolOpenAI")], ["anthropic-messages", t("arena.settings.protocolAnthropic")]].map(([val, label]) => (
              <button key={val} className={`px-2.5 py-1 rounded-lg ${api === val ? "bg-blue-500 text-white" : "bg-white/5 opacity-70 hover:opacity-100"}`} onClick={() => setApi(val)} data-vendor-api-opt={`${entry.id}:${val}`}>{label}</button>
            ))}
          </div>
        </div>
      )}
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
          {fetched && fetched !== "busy" && fetched.ok && (fetched.models ?? []).length > 0 && (
            <div className="rounded-lg border border-white/10 bg-black/20 p-1.5" data-vendor-fetched={entry.id}>
              <div className="flex items-center gap-2 text-[10px] px-0.5 pb-1">
                <span className="flex-1 opacity-70">{t("arena.settings.selected", { sel: selected.size, total: fetched.models.length })}</span>
                <button className="opacity-70 hover:opacity-100" onClick={() => setModelsText(fetched.models.join(", "))} data-vendor-selall={entry.id}>{t("arena.settings.selectAll")}</button>
                <button className="opacity-70 hover:opacity-100" onClick={() => setModelsText("")}>{t("arena.settings.clear")}</button>
              </div>
              <div className="max-h-44 overflow-y-auto flex flex-col">
                {fetched.models.map((m) => {
                  const on = selected.has(m);
                  return (
                    <button
                      key={m}
                      className={`flex items-center gap-1.5 px-1 py-0.5 rounded text-left font-mono text-[10px] ${on ? "bg-blue-500/15" : "hover:bg-white/5"}`}
                      onClick={() => toggleModel(m)}
                      data-vendor-model-option={m}
                    >
                      <span className={`w-3 h-3 shrink-0 rounded border flex items-center justify-center text-[9px] leading-none ${on ? "bg-blue-500 border-blue-400 text-white" : "border-white/20"}`}>{on ? "✓" : ""}</span>
                      <span className="truncate flex-1">{m}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <button
          className="shrink-0 px-2 py-1 rounded-lg text-[11px] bg-white/5 hover:bg-white/10 disabled:opacity-40"
          disabled={fetched === "busy"}
          onClick={doFetch}
          data-vendor-fetch={entry.id}
        >
          {fetched === "busy" ? "…" : t("arena.settings.fetch")}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[10px]">
          {fetched && fetched !== "busy" && <span className={fetched.ok ? "text-emerald-400" : "text-red-400"}>{fetched.msg}</span>}
          {(!fetched || fetched === "busy") && test && test !== "busy" && <span className={test.ok ? "text-emerald-400" : "text-red-400"}>{test.msg}</span>}
        </span>
        <button
          className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-500 text-white disabled:opacity-40"
          disabled={!dirty}
          onClick={() => onSave(entry.id, { ...entry, key: key.trim(), baseUrl: baseUrl.trim(), models: modelsText.split(/[,，]/).map((x) => x.trim()).filter(Boolean), api, enabled: true })}
          data-vendor-save={entry.id}
        >
          {t("arena.settings.save")}
        </button>
      </div>
    </div>
  );
}

/** 名称 → 厂商 ID slug（小写字母数字连字符；禁止 / ——网关按 / 切模型命名空间）。 */
function slugifyId(name) {
  const s = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return s || "custom";
}

/** 自定义厂商弹窗（镜像 ModelTreeModal 骨架；ID 自动 slug、手改后停止跟随）。 */
function CustomVendorModal({ existingIds, onAdd, onClose }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [api, setApi] = useState("openai-completions");
  const effId = idTouched ? id : slugifyId(name);
  const idOk = /^[a-z0-9][a-z0-9-]*$/.test(effId);
  const idFree = idOk && !existingIds.has(effId);
  const error = !name.trim() ? t("arena.settings.nameRequired") : !idOk ? t("arena.settings.idInvalid") : !idFree ? t("arena.settings.idTaken") : null;
  const attempted = name.trim() !== "" || effId !== "" || baseUrl.trim() !== "" || key.trim() !== "";
  return createPortal(
    <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/50" onClick={onClose} data-custom-modal-backdrop>
      <div className="w-[460px] flex flex-col rounded-2xl border border-white/15 bg-[#1d1d1f]/95 text-white shadow-2xl" onClick={(e) => e.stopPropagation()} data-custom-modal>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <h3 className="text-sm font-semibold flex-1">{t("arena.settings.customTitle")}</h3>
          <button type="button" onClick={onClose} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/70 text-xs" data-custom-modal-close>✕</button>
        </div>
        <div className="flex flex-col gap-2.5 px-4 py-3 text-[11px]">
          <div className="flex items-center gap-2">
            <label className="opacity-60 w-16 shrink-0">{t("arena.settings.custName")}</label>
            <input className="flex-1 bg-black/40 rounded-lg px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Relay" autoFocus data-custom-name />
          </div>
          <div className="flex items-center gap-2">
            <label className="opacity-60 w-16 shrink-0">{t("arena.settings.custId")}</label>
            <input className="flex-1 bg-black/40 rounded-lg px-2 py-1 font-mono" value={effId} onChange={(e) => { setIdTouched(true); setId(e.target.value.toLowerCase()); }} placeholder="my-relay" data-custom-id />
          </div>
          <div className="flex items-center gap-2">
            <label className="opacity-60 w-16 shrink-0">Base URL</label>
            <input className="flex-1 bg-black/40 rounded-lg px-2 py-1 font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" data-custom-url />
          </div>
          <div className="flex items-center gap-2">
            <label className="opacity-60 w-16 shrink-0">{t("arena.settings.protocol")}</label>
            <div className="flex gap-1">
              {[["openai-completions", t("arena.settings.protocolOpenAI")], ["anthropic-messages", t("arena.settings.protocolAnthropic")]].map(([val, label]) => (
                <button key={val} type="button" className={`px-2.5 py-1 rounded-lg ${api === val ? "bg-blue-500 text-white" : "bg-white/5 opacity-70 hover:opacity-100"}`} onClick={() => setApi(val)} data-custom-api={val}>{label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="opacity-60 w-16 shrink-0">API Key</label>
            <input className="flex-1 bg-black/40 rounded-lg px-2 py-1 font-mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" data-custom-key />
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
          <span className="flex-1 text-[11px] text-red-400 truncate" data-custom-error>{attempted && error ? error : ""}</span>
          <button type="button" onClick={onClose} className="px-3 py-1 rounded-lg text-xs border border-white/10 bg-black/40">{t("arena.model.cancel")}</button>
          <button
            type="button"
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-blue-500 text-white disabled:opacity-40"
            disabled={!name.trim() || !idFree}
            onClick={() => onAdd({ id: effId, name: name.trim(), api, key: key.trim(), baseUrl: baseUrl.trim() })}
            data-custom-confirm
          >
            {t("arena.settings.add")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ModelSettings() {
  const { t } = useI18n();
  const [config, setConfig] = useState({ vendors: [] });
  const [groupFilter, setGroupFilter] = useState("cn");
  const [catalogQuery, setCatalogQuery] = useState("");
  const groups = useMemo(() => catalogByGroup(), []);
  const [showCustom, setShowCustom] = useState(false);
  const reload = () => void readModelConfig().then(setConfig);
  useEffect(reload, []);
  const configured = new Set(config.vendors.map((v) => v.id));
  const takenIds = useMemo(() => new Set([...VENDOR_BY_ID.keys(), ...config.vendors.map((v) => v.id)]), [config.vendors]); // 自定义 ID 查重：目录 + 已配置
  const addVendor = (id) => { void saveModelConfig([...config.vendors, { id, key: "", baseUrl: VENDOR_BY_ID.get(id)?.defaultUrl ?? "", models: [], enabled: true }]).then(reload); };
  const addCustomVendor = (d) => { void saveModelConfig([...config.vendors, { id: d.id, name: d.name, custom: true, api: d.api, key: d.key, baseUrl: d.baseUrl, models: [], enabled: true }]).then(reload); setShowCustom(false); };
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
          <button className="px-2 py-1 rounded-lg text-[11px] bg-white/5 hover:bg-white/10 shrink-0" onClick={() => setShowCustom(true)} data-settings-add-custom>＋ {t("arena.settings.addCustom")}</button>
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
        {showCustom && <CustomVendorModal existingIds={takenIds} onAdd={addCustomVendor} onClose={() => setShowCustom(false)} />}
      </div>
    </div>
  );
}
