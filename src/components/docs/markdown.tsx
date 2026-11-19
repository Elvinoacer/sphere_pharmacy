import type { ReactNode } from "react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Link2 } from "lucide-react"
import { resolveDocLink, type DocRecord } from "@/lib/docs/content"
import { Slugger } from "@/lib/docs/utils"
import { CodeBlock } from "./code-block"
import { MermaidDiagram } from "./mermaid-diagram"
import "./docs.css"

/**
 * Server markdown renderer for the documentation portal.
 * - headings get stable anchors (same algorithm as extractHeadings)
 * - internal .md links are rewritten to portal routes
 * - ```mermaid blocks render as interactive diagrams
 * - raw HTML is not rendered (react-markdown default) — content is sanitized
 */

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (typeof node === "object" && "props" in (node as unknown as Record<string, unknown>)) {
    const props = (node as unknown as { props?: { children?: ReactNode } }).props
    return extractText(props?.children)
  }
  return ""
}

const CALLOUT_KINDS: Record<string, { title: string }> = {
  note: { title: "Note" },
  tip: { title: "Tip" },
  important: { title: "Important" },
  warning: { title: "Warning" },
  caution: { title: "Caution" },
}

export function Markdown({ doc, body }: { doc: DocRecord; body?: string }) {
  const source = body ?? doc.body
  const slugger = new Slugger()

  return (
    <div className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 id={slugger.slug(extractText(children))}>{children}</h1>,
          h2: ({ children }) => <Heading level={2} slugger={slugger}>{children}</Heading>,
          h3: ({ children }) => <Heading level={3} slugger={slugger}>{children}</Heading>,
          h4: ({ children }) => <Heading level={4} slugger={slugger}>{children}</Heading>,
          a: ({ children, href }) => {
            if (!href) return <>{children}</>
            const internal = resolveDocLink(href, doc)
            if (internal) {
              return (
                <Link href={internal}>
                  {children}
                </Link>
              )
            }
            if (href.startsWith("#")) {
              return <a href={href}>{children}</a>
            }
            // Repository file reference (not a portal document): render as text, never a broken link.
            if (/^(\.{0,2}\/)?[\w./-]+\.[a-z0-9]{2,5}$/i.test(href) && !href.startsWith("http")) {
              return <span className="docs-repo-file" title="Repository file — see the project source">{children}</span>
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children
            if (
              child &&
              typeof child === "object" &&
              "props" in (child as Record<string, unknown>)
            ) {
              const props = (child as { props?: { className?: string; children?: ReactNode } }).props
              const className = props?.className ?? ""
              const code = extractText(props?.children ?? "")
              const language = /language-(\S+)/.exec(className)?.[1]
              if (language === "mermaid") {
                return <MermaidDiagram code={code} title={doc.title} />
              }
              return <CodeBlock code={code} language={language} />
            }
            return <pre>{children}</pre>
          },
          table: ({ children }) => (
            <div className="docs-table-wrap docs-scrollbar" tabIndex={0} role="region" aria-label="Table">
              <table>{children}</table>
            </div>
          ),
          blockquote: ({ children }) => {
            const first = Array.isArray(children) ? children[0] : children
            const text = extractText(first)
            const alert = /^\[!(note|tip|important|warning|caution)\]\s*/i.exec(text)
            if (alert) {
              const kind = alert[1].toLowerCase()
              const title = CALLOUT_KINDS[kind]?.title ?? "Note"
              const rest = Array.isArray(children) ? [...children] : [children]
              // Strip the [!kind] marker from the first child's text.
              const firstChild = rest[0]
              if (firstChild && typeof firstChild === "object" && "props" in (firstChild as Record<string, unknown>)) {
                const props = (firstChild as { props: { children?: ReactNode } }).props
                const childText = extractText(props.children).replace(alert[0], "")
                rest[0] = <p>{childText}</p>
              }
              return (
                <div className="docs-callout" data-callout={kind} role="note">
                  <span className="docs-callout-title">{title}</span>
                  {rest}
                </div>
              )
            }
            return <blockquote>{children}</blockquote>
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}

function Heading({
  level,
  slugger,
  children,
}: {
  level: 2 | 3 | 4
  slugger: Slugger
  children: ReactNode
}) {
  const id = slugger.slug(extractText(children))
  const Tag = `h${level}` as const
  return (
    <Tag id={id}>
      {children}
      <a href={`#${id}`} className="docs-heading-anchor" aria-label="Link to this section">
        <Link2 className="inline h-3.5 w-3.5 align-[-0.125em]" aria-hidden />
      </a>
    </Tag>
  )
}
