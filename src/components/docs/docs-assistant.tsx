"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUpRight, Bot, FileText, Loader2, RotateCcw, Send, Sparkles, User, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import "./docs.css"

export interface Citation {
  index: number
  title: string
  heading: string
  url: string
  anchor: string
  category: string
  status: string
  snippet: string
}

interface Turn {
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  synthesized?: boolean
  elapsedMs?: number
}

const STARTER_PROMPTS = [
  "How does pharmacist prescription verification work end-to-end?",
  "How does BandaGo POS outbound reconciliation and stagnant-POS protection work?",
  "What happens when an M-Pesa STK Push times out or is uncertain?",
  "Which authorization guards protect API routes and what roles exist?",
  "How does guest order tracking and phone OTP order claiming work?",
  "What environment variables are required for production deployment?",
]

export function DocsAssistant({ pageContext }: { pageContext?: string }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [turns, loading])

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || loading) return
    setError(null)
    const nextTurns: Turn[] = [...turns, { role: "user", content: trimmed }]
    setTurns(nextTurns)
    setInput("")
    setLoading(true)
    const startedAt = performance.now()
    try {
      const history = nextTurns.map((t) => ({ role: t.role, content: t.content }))
      const response = await fetch("/api/docs-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          ...(pageContext ? { pageContext } : {}),
        }),
      })
      if (response.status === 401 || response.status === 403) {
        throw new Error("Staff session required. Please sign in with your staff account to use Ask Sphere Docs.")
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || `Request failed (${response.status})`)
      }
      const data = (await response.json()) as {
        reply: string
        citations: Citation[]
        synthesized: boolean
      }
      const elapsedMs = Math.round(performance.now() - startedAt)
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          citations: data.citations,
          synthesized: data.synthesized,
          elapsedMs,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : "The documentation assistant could not be reached.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary" aria-hidden>
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Ask Sphere Docs</p>
            <p className="text-xs text-muted-foreground">
              Grounded in <span className="docs-repo-file">docs/</span>, <span className="docs-repo-file">openapi/</span> &amp;{" "}
              <span className="docs-repo-file">prisma/</span> — answers cite exact sections
            </p>
          </div>
        </div>
        {turns.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTurns([])
              setError(null)
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            New conversation
          </Button>
        ) : null}
      </div>

      <div className="docs-scrollbar min-h-96 max-h-[36rem] flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {turns.length === 0 ? (
          <div className="py-4">
            {pageContext ? (
              <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Focusing on <span className="font-semibold text-foreground">{pageContext}</span> (all documentation remains searchable).
              </p>
            ) : null}
            <p className="text-sm font-medium text-foreground">Ask anything about Sphere Pharmacy operations or engineering</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The assistant searches across all 129 documentation pages, user journeys, OpenAPI endpoints, and Prisma models to synthesize a cited answer with direct links.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => ask(prompt)}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background p-3 text-left text-xs font-medium text-foreground transition-colors hover:border-ring hover:bg-accent/50"
                >
                  <span>{prompt}</span>
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-accent text-primary"
                }`}
                aria-hidden
              >
                {turn.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {turn.role === "user" ? "You" : "Sphere Docs"}
                  </p>
                  {turn.role === "assistant" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                      <Zap className="h-2.5 w-2.5 text-primary" aria-hidden />
                      {turn.synthesized ? "AI synthesized" : "Instant corpus synthesis"}
                      {typeof turn.elapsedMs === "number" ? ` · ${turn.elapsedMs}ms` : ""}
                    </span>
                  ) : null}
                </div>
                <div className="docs-prose docs-prose-compact mt-1">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => {
                        if (href?.startsWith("/docs")) {
                          return (
                            <Link href={href} className="font-medium text-primary underline underline-offset-2">
                              {children}
                            </Link>
                          )
                        }
                        return <span>{children}</span>
                      },
                    }}
                  >
                    {turn.content}
                  </ReactMarkdown>
                </div>

                {turn.citations && turn.citations.length > 0 ? (
                  <div className="mt-3 space-y-1.5" aria-label="Cited documentation sections">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Top matched sources ({turn.citations.length})
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {turn.citations.map((citation) => {
                        const href = citation.anchor ? `${citation.url}#${citation.anchor}` : citation.url
                        return (
                          <Link
                            key={`${citation.url}-${citation.anchor}-${citation.index}`}
                            href={href}
                            className="group flex items-start gap-2 rounded-lg border border-border bg-background p-2.5 text-xs transition-colors hover:border-ring"
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent font-mono text-[0.6875rem] font-bold text-primary">
                              {citation.index}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1 font-semibold text-foreground group-hover:text-primary">
                                <FileText className="h-3 w-3 shrink-0" aria-hidden />
                                <span className="truncate">{citation.title}</span>
                              </span>
                              {citation.heading && citation.heading !== citation.title ? (
                                <span className="block truncate text-[0.6875rem] text-muted-foreground">
                                  § {citation.heading}
                                </span>
                              ) : null}
                              <span className="mt-0.5 line-clamp-2 block text-[0.6875rem] text-muted-foreground">
                                {citation.snippet}
                              </span>
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            Searching documentation corpus &amp; synthesizing answer…
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void ask(input)
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about a journey, feature, API route, database model or runbook…"
          aria-label="Ask the documentation assistant"
          maxLength={600}
          className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Button type="submit" size="sm" disabled={loading || !input.trim()} className="h-10 px-4">
          <Send className="h-4 w-4" aria-hidden />
          <span>Ask</span>
        </Button>
      </form>
    </div>
  )
}
