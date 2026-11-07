/**
 * 模型选择器（chayuan-game 自建，ModelTreeSelect 同 props 契约）：厂商分组
 * 树形清单（treeNodes = [{id,label,children:[{id,value}]}]）、single/multi
 * 两模式、深色弹层。自建理由：harness 版依赖 chatop-models 轮询面，本项目
 * 数据源是本地配置（settings/store.js），仅保 UI 契约。
 */
import { useMemo, useState } from "react";
import VendorLogo from "./VendorLogo.jsx";
import { VENDOR_BY_ID } from "../vendors/catalog.js";

export default function ModelPicker({ nodes = [], selected, onChange, mode = "multi", flat = false }) {
  const selSet = useMemo(() => new Set(selected ?? []), [selected]);
  const [openIds, setOpenIds] = useState(() => new Set(nodes.slice(0, 1).map((n) => n.id))); // 默认展开首组（defaultOpenDepth=1 契约）
  const toggleGroup = (id) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pick = (value) => {
    if (mode === "single") return onChange(new Set([value]));
    const n = new Set(selSet);
    if (n.has(value)) n.delete(value); else n.add(value);
    onChange(n);
  };
  if (!nodes.length) return <p className="text-[11px] text-white/40 py-2">…</p>;
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/40" data-model-picker>
      {nodes.map((g) => {
        const open = openIds.has(g.id);
        const v = VENDOR_BY_ID.get(g.id);
        const gSel = (g.children ?? []).every((c) => selSet.has(c.value));
        return (
          <div key={g.id}>
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5"
              onClick={() => toggleGroup(g.id)}
              data-model-group={g.id}
            >
              <span className="opacity-60">{open ? "▾" : "▸"}</span>
              <VendorLogo logo={v?.logo} name={g.label} size={16} />
              <span className="flex-1 font-medium truncate">{g.label}</span>
              <span className="opacity-40">{(g.children ?? []).length}</span>
              {mode === "multi" && (
                <span
                  role="button"
                  tabIndex={0}
                  className={`px-1.5 rounded text-[10px] border ${gSel ? "border-blue-400 text-blue-300" : "border-white/15 opacity-60"}`}
                  onClick={(e) => { e.stopPropagation(); onChange(gSel ? new Set([...selSet].filter((x) => !(g.children ?? []).some((c) => c.value === x))) : new Set([...selSet, ...(g.children ?? []).map((c) => c.value)])); }}
                >
                  {gSel ? "×" : "全选"}
                </span>
              )}
            </button>
            {open && (g.children ?? []).map((c) => (
              <button
                key={c.value}
                type="button"
                className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left text-xs ${selSet.has(c.value) ? "bg-blue-500/15" : "hover:bg-white/5"}`}
                onClick={() => pick(c.value)}
                data-model-leaf={c.value} data-tree-leaf-check={c.value}
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${selSet.has(c.value) ? "bg-blue-500 border-blue-400" : "border-white/20"}`}>
                  {selSet.has(c.value) ? "✓" : ""}
                </span>
                <span className="font-mono truncate">{c.value.split("/").slice(1).join("/")}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
