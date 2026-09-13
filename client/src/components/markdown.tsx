// client/src/components/markdown.tsx
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { CodeBlock } from "@/components/code-block"

const components: Components = {
  // Fenced blocks arrive as <pre><code>. `code` renders the block itself, so
  // <pre> becomes a passthrough to avoid a box inside a box.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? "")
    const isBlock = /language-/.test(className ?? "") || text.includes("\n")
    if (isBlock) {
      return (
        <CodeBlock className="max-h-96 border bg-muted/40 p-3">
          {text.replace(/\n$/, "")}
        </CodeBlock>
      )
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    )
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
}

/**
 * Assistant text as Markdown. Typography is applied to the wrapper with
 * descendant selectors — the project has no typography plugin, and this keeps
 * every colour a semantic token.
 */
export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm/relaxed wrap-break-word [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:pb-1 [&_th]:font-medium [&_td]:border-b [&_td]:py-1 [&_hr]:border-border">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
