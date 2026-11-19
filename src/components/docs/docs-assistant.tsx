"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import { ArrowUp, Check, Copy, Eraser, ExternalLink, MessageCircleQuestion, Sparkles, Zap } from "lucide-react"

interface Citation {
  n: number
  title: string
  heading: string
  url: string
  snippet: string
}

interface AssistantMessage {
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  provider?: string
}

const SUGGESTED_QUESTIONS = [
  "How do I approve a prescription?",
  "What happens when a customer cancels an order?",
  "How are riders assigned deliveries?",
  "How does the M-Pesa callback work?",
  "Which model stores prescription records?",
  "What can an administrator configure?",
  "How does BandaGo synchronize inventory?",
  "What happens when stock is unavailable?",
]

export function DocsAssistant({ pageContext }: { pageContext?: string }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, busy])

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || busy) return
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: trimmed }])
    setBusy(true)
    try {
      const history = [...messages, { role: "user" as const, content: trimmed }].slice(-6).map((m) => ({ role: m.role, content: m.content }))
      const response = await fetch("/api/docs-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: pageContext && !startedRef.current
            ? [{ role: "user", content: `About the page "${pageContext}": ${trimmed}` }, ...history].slice(-6)
            : history,
        }),
      })
      startedRef.current = true
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || "request failed")
      setProvider(data.provider ?? null)
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, citations: data.citations ?? [], provider: data.provider },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong reaching the assistant. Please try again in a moment — the search palette (⌘K) always works without AI.",
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  async function copyLast() {
    const last = [...messages].reverse().find((m) => m.role === "assistant")
    if (!last) return
    try {
      await navigator.clipboard.writeText(last.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")

  return (
    <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="font-medium text-foreground">Ask Sphere Docs</span>
        <span className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5" title={provider === "groq" ? "Answers synthesized with Groq over retrieved docs" : provider === "lexical" ? "Answers from lexical retrieval over the docs corpus" : "Provider status appears after the first question"}>
          <Zap className="h-3 w-3" aria-hidden />
          {provider === "groq" ? "Groq + retrieval" : provider === "lexical" ? "Retrieval mode" : "Grounded in docs/"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {lastAssistant ? (
            <button type="button" onClick={copyLast} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
              {copied ? "Copied" : "Copy answer"}
            </button>
          ) : null}
          {messages.length > 0 ? (
            <button type="button" onClick={() => { setMessages([]); setProvider(null); startedRef.current = false }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              <Eraser className="h-3 w-3" aria-hidden />
              Clear
            </button>
          ) : null}
        </span>
      </div>

      {/* Messages */}
      <div className="docs-scrollbar flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
        {messages.length === 0 ? (
          <div className="py-6 text-center">
            <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden>
              <MessageCircleQuestion className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium text-foreground">
              {pageContext ? `Ask anything about “${pageContext}”` : "Ask anything about Sphere Pharmacy"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              Answers are generated strictly from the documentation corpus, with citations that open the exact
              section. The assistant never reads account, customer or prescription data.
            </p>
            <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => ask(question)}
                  className="rounded-lg border border-border bg-background px-3 py-2.5 text-left text-xs text-foreground transition-colors hover:border-ring hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-foreground"
                }`}
              >
                {message.role === "assistant" ? (
                  <div className="docs-prose docs-prose-compact">
                    <ReactMarkdown
                      components={{
                        a: ({ children, href }) => (
                          <a href={href} className="text-primary underline underline-offset-2">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                    {message.citations && message.citations.length > 0 ? (
                      <div className="mt-3 border-t border-border pt-3">
                        <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">Sources</p>
                        <ul className="space-y-1.5">
                          {message.citations.map((citation) => (
                            <li key={citation.n}>
                              <Link
                                href={citation.url}
                                className="group flex items-start gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 transition-colors hover:border-ring"
                              >
                                <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[0.625rem] font-bold text-primary">
                                  {citation.n}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-foreground group-hover:text-primary">
                                    {citation.title}
                                    {citation.heading && citation.heading !== citation.title ? ` — ${citation.heading}` : ""}
                                  </span>
                                  <span className="mt-0.5 block line-clamp-2 text-[0.6875rem] leading-relaxed text-muted-foreground">{citation.snippet}</span>
                                </span>
                                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))
        )}
        {busy ? (
          <div className="flex justify-start" aria-live="polite">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
              Retrieving documentation and composing an answer…
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        className="border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(input)
        }}
      >
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="docs-assistant-input">Question</label>
          <textarea
            id="docs-assistant-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void ask(input)
              }
            }}
            rows={Math.min(4, Math.max(1, input.split("\n").length))}
            placeholder="Ask about journeys, orders, prescriptions, payments, the API, the database…"
            className="docs-scrollbar max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            maxLength={1200}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
            aria-label="Send question"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-[0.6875rem] text-muted-foreground">
          Grounded in the public docs corpus — no account, customer or prescription data. Rate-limited to 20 questions per hour.
        </p>
      </form>
    </div>
  )
}
