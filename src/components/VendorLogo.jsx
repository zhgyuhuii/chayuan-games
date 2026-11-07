/**
 * 厂商 logo 圆标（模型设置/默认模型/模型树三处共用）：嵌入 data URI 优先；
 * logo 缺失、不在嵌入表或 <img> 加载失败（如 cephalon.svg 曾是坏 UTF-8 占位
 * 导致解析失败出破图）时回退显示名首字母渐变圆标——任何情况下不出破图。
 */
import { useState } from "react";
import { EMBEDDED_MODEL_LOGOS } from "../vendors/generated-model-logos.js";

/** 加载失败记忆（模块级）：内联父组件重渲染会重挂载本组件，避免 img 反复报错。 */
const BROKEN_LOGOS = new Set();

export default function VendorLogo({ logo, name, size = 18, className = "" }) {
  const [failed, setFailed] = useState(() => BROKEN_LOGOS.has(logo));
  const uri = logo && !failed ? EMBEDDED_MODEL_LOGOS[logo] : null;
  if (uri) {
    return (
      <img
        src={uri}
        alt=""
        onError={() => { BROKEN_LOGOS.add(logo); setFailed(true); }}
        className={`rounded-[5px] object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = String(name ?? "").replace(/[（(].*$/, "").slice(0, 1) || "?";
  return (
    <span
      className={`rounded-[5px] bg-linear-to-br from-blue-500 to-violet-500 text-white flex items-center justify-center font-semibold shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >{initial}</span>
  );
}
