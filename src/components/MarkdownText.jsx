/**
 * 聊天 Markdown 渲染（2026-10-29）：模型回复（qwen 等）天然输出 GFM——
 * 表格/代码块/SQL/标题/加粗，纯文本直显会把 `###`、`**`、`|---|` 当字符印
 * 出来（用户报障「特殊字符没处理」）。复用 MarkedView 同款管线
 * （marked + DOMPurify 消毒）与全局 cg-markdown 样式；不套 md-dark/
 * md-light 背景类（气泡自带底色，样式类是灰系中性色两态通用）。
 * 流式安全：text 每帧变化重解析，聊天级长度毫秒级；未闭合的 Markdown
 * 语法在补全前按原文显示（所有聊天 UI 的通行行为）。
 */
import React, { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

// 链接一律新窗口打开：气泡内 <a> 默认在本窗口导航，会把聊天窗顶走。
// 模块级一次性挂 hook（MarkedView 共享同一 DOMPurify 实例，同受益）。
if (typeof window !== "undefined" && !DOMPurify.__chatopLinkHook) {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  try { DOMPurify.__chatopLinkHook = true } catch { /* 冻结对象等极端场景忽略 */ }
}

export default function MarkdownText({ text, className = "" }) {
  const html = useMemo(() => {
    const raw = String(text ?? "");
    if (raw === "") return "";
    try {
      return DOMPurify.sanitize(marked.parse(raw));
    } catch {
      return DOMPurify.sanitize(raw.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])));
    }
  }, [text]);
  if (html === "") return null;
  return (
    <div
      className={`cg-markdown text-[13.5px] leading-relaxed break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
