/**
 * 轻量 i18n（共识 §二#11）：zh/en 双语、词典平铺、"t(key, params)" {x} 插值、
 * 缺键回落 en → key 本身。引擎层零文案依赖（同构面无 i18n import）。
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import dict from "./dict-arena.js";

const DICTS = { zh: dict.zh, en: dict.en };

export function translate(lang, key, params) {
  // harness 词典键无 "arena." 前缀（host 层命名空间机制）——轻量版等价：查前剥
  const bare = key?.startsWith?.("arena.") ? key.slice(6) : key;
  const raw = DICTS[lang]?.[bare] ?? DICTS[lang]?.[key] ?? DICTS.en?.[bare] ?? DICTS.en?.[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem("chayuan-game:lang") ?? "zh");
  const switchLang = useCallback((next) => {
    localStorage.setItem("chayuan-game:lang", next);
    setLang(next);
  }, []);
  const value = useMemo(() => ({
    lang,
    t: (key, params) => translate(lang, key, params),
    setLang: switchLang,
  }), [lang, switchLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // 无 Provider（单测）：回落静态 zh（渲染正常、切换不触发重渲染）
  return { lang: "zh", t: (key, params) => translate("zh", key, params), setLang: () => {} };
}
