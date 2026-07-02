"use client";
import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";

interface MdRenderProps {
  content: string;
}

export default function MdRender({ content }: MdRenderProps) {
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs">
          {children}
        </pre>
      ),
      code: ({ className, children }) => {
        const text = String(children ?? "");
        const match = /language-(\w+)/.exec(className ?? "");
        // No language- class => inline code.
        if (!match) {
          return (
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">
              {children}
            </code>
          );
        }
        const lang = match[1];
        let html = text;
        try {
          html = hljs.getLanguage(lang)
            ? hljs.highlight(text, { language: lang }).value
            : hljs.highlightAuto(text).value;
        } catch {
          html = text;
        }
        return (
          <code
            className={className}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      },
    }),
    [],
  );

  return (
    <div className="max-w-none wrap-break-word text-sm leading-relaxed text-zinc-800 [&_a]:text-sky-600 [&_a:hover]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-zinc-600 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_ol]:my-2 [&_p]:my-2 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-zinc-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_ul]:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
