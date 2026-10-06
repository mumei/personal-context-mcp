/**
 * @packageDocumentation
 * Converts Markdown into HTML for web display and sanitizes the result.
 * It does not send HTTP responses, persist data, or generate Markdown documents.
 * Web 表示向けに Markdown を HTML へ変換し、その結果をサニタイズする。
 * HTTP 応答の送信、データの永続化、Markdown 文書の生成は担当しない。
 */
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const bareUrlUntilJapaneseSentencePunctuation =
  /^((?:https?:\/\/|www\.)[^\s<、。！？：；，．「」『』【】（）［］｛｝〈〉《》〔〕…]+)/u;

/**
 * Marked treats Japanese sentence punctuation as part of a GFM bare URL. Keep
 * that punctuation in the surrounding prose while preserving Unicode paths.
 */
const markdownRenderer = new Marked({
  tokenizer: {
    url(src) {
      const match = bareUrlUntilJapaneseSentencePunctuation.exec(src);
      if (!match) return false;

      let raw = match[1];
      while (true) {
        const trimmed = this.rules.inline._backpedal.exec(raw)?.[0] ?? "";
        if (trimmed === raw) break;
        raw = trimmed;
      }
      if (!raw) return false;

      const href = raw.startsWith("www.") ? `http://${raw}` : raw;
      return { type: "link", raw, text: raw, href, tokens: [{ type: "text", raw, text: raw }] };
    },
  },
});

/**
 * Converts Markdown into safe HTML using an allowlist.
 * Markdown を許可リストに基づく安全な HTML へ変換する。
 */
export function renderMarkdownBody(markdown: string): string {
  const rendered = markdownRenderer.parse(markdown, { async: false, gfm: true });
  return sanitizeHtml(rendered, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "input"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      code: ["class"],
      img: ["src", "alt", "title", "width", "height"],
      input: ["type", "checked", "disabled"],
      li: ["class"],
      ul: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({ tagName: "a", attribs: { ...attributes, target: "_blank", rel: "noreferrer" } }),
    },
  });
}
