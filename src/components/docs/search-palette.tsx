"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Boxes, Database, FileText, MessageCircleQuestion, Route, Search, UserRound } from "lucide-react"
import type { SearchEntry } from "@/lib/docs/search"

/**
 * Global documentation search palette (Ctrl/Cmd+K). Fetches the build-time
 * lexical index from /api/docs-index once, then searches entirely client-side
 * so search keeps working without any AI provider.
 */

const KIND_LABELS: Record<SearchEntry["k"], string> = {
  doc: "Documents",
  journey: "Journeys",
  role: "Role maps",
  api: "API endpoints",
}

const KIND_ICONS: Record<SearchEntry["k"], typeof FileText> = {
  doc: FileText,
  journey: Route,
  role: UserRound,
  api: Boxes,
}

const AUDIENCES: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "operations", label: "Pharmacy ops" },
  { id: "engineering", label: "Engineering" },
  { id: "administration", label: "Admin" },
]

function tokenizeClient(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[`*_~[\]()#>|-]/g, " ")
    .split(/[^a-z0-9.:/+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
}

/** Mirrors termVariants in src/lib/docs/search.ts (light suffix stripping). */
function termVariantsClient(term: string): string[] {
  const variants = new Set<string>([term])
  if (term.length > 4) {
    if (term.endsWith("ies")) variants.add(`${term.slice(0, -3)}y`)
    if (term.endsWith("es")) variants.add(term.slice(0, -2))
    if (term.endsWith("s") && !term.endsWith("ss")) variants.add(term.slice(0, -1))
    if (term.endsWith("ing")) variants.add(term.slice(0, -3))
    if (term.endsWith("ed")) variants.add(term.slice(0, -2))
  }
  return [...variants].filter((v) => v.length >= 3)
}

function score(entry: SearchEntry, terms: string[]): number {
  if (!terms.length) return 0
  const title = entry.t.toLowerCase()
  const heading = (entry.h || "").toLowerCase()
  const body = entry.b.toLowerCase()
  let score = 0
  let matched = 0
  for (const term of terms) {
    const variants = termVariantsClient(term)
    let hit = false
    if (variants.some((v) => title === v)) { score += 14; hit = true }
    else if (variants.some((v) => title.includes(v))) { score += 8; hit = true }
    if (variants.some((v) => heading.includes(v))) { score += 5; hit = true }
    if (variants.some((v) => body.includes(v))) { score += 2; hit = true }
    if (hit) matched++
  }
  if (matched === terms.length) score += 6
  return score
}

function highlight(text: string, terms: string[]): Array<{ text: string; hit: boolean }> {
  if (!terms.length) return [{ text, hit: false }]
  const pattern = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|")
  const regex = new RegExp(`(${pattern})`, "gi")
  return text
    .split(regex)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: regex.test(part) }))
}

function snippetFor(entry: SearchEntry, terms: string[]): string {
  const source = entry.h ? `${entry.h}. ${entry.b}` : entry.b
  if (!terms.length) return source.slice(0, 140)
  const lower = source.toLowerCase()
  let index = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found !== -1 && (index === -1 || found < index)) index = found
  }
  if (index === -1) return source.slice(0, 140)
  const start = Math.max(0, index - 40)
  return (start > 0 ? "…" : "") + source.slice(start, start + 150)
}

export interface SearchPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function useDocsSearch() {
  const [index, setIndex] = useState<SearchEntry[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (index || error) return
    fetch("/api/docs-index")
      .then((response) => {
        if (!response.ok) throw new Error(`index ${response.status}`)
        return response.json() as Promise<{ entries: SearchEntry[] }>
      })
      .then((data) => {
        if (!cancelled) setIndex(data.entries ?? [])
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [index, error])

  return { index, error }
}

export function SearchPalette({ open, onOpenChange }: SearchPaletteProps) {
  const router = useRouter()
  const { index, error } = useDocsSearch()
  const [query, setQuery] = useState("")
  const [audience, setAudience] = useState("all")
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      setSelected(0)
      const timer = setTimeout(() => inputRef.current?.focus(), 40)
      return () => clearTimeout(timer)
    }
  }, [open])

  const results = useMemo(() => {
    if (!index) return []
    const terms = tokenizeClient(query)
    const filtered = audience === "all" ? index : index.filter((entry) => entry.g.includes(audience as SearchEntry["g"][number]))
    const scored = filtered
      .map((entry) => ({ entry, score: score(entry, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.t.localeCompare(b.entry.t))
      .slice(0, 24)
    return scored
  }, [index, query, audience])

  useEffect(() => {
    setSelected(0)
  }, [query, audience])

  const go = useCallback(
    (entry: SearchEntry) => {
      onOpenChange(false)
      const url = entry.a ? `${entry.p}#${entry.a}` : entry.p
      router.push(url)
    },
    [onOpenChange, router],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelected((prev) => Math.min(results.length - 1, prev + 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelected((prev) => Math.max(0, prev - 1))
      } else if (event.key === "Enter") {
        event.preventDefault()
        const item = results[selected]
        if (item) go(item.entry)
      }
    },
    [go, results, selected],
  )

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    node?.scrollIntoView({ block: "nearest" })
  }, [selected])

  const terms = tokenizeClient(query)
  const grouped = useMemo(() => {
    const groups = new Map<SearchEntry["k"], Array<{ entry: SearchEntry; index: number }>>()
    let flatIndex = 0
    for (const item of results) {
      const list = groups.get(item.entry.k) ?? []
      list.push({ entry: item.entry, index: flatIndex++ })
      groups.set(item.entry.k, list)
    }
    return [...groups.entries()]
  }, [results])

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Search documentation"
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-foreground/25 backdrop-blur-[2px] transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        className={`absolute left-1/2 top-[12vh] w-[min(92vw,40rem)] max-h-[70vh] -translate-x-1/2 flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl transition-all duration-150 ${open ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documentation, journeys, API endpoints…"
            aria-label="Search query"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            tabIndex={open ? 0 : -1}
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground" aria-hidden>
            ESC
          </kbd>
        </div>
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2" role="group" aria-label="Filter by audience">
          {AUDIENCES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAudience(option.id)}
              aria-pressed={audience === option.id}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                audience === option.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="ml-auto text-[0.6875rem] text-muted-foreground" aria-live="polite">
            {index ? `${index.length} indexed sections` : error ? "index unavailable" : "loading index…"}
          </span>
        </div>
        <div ref={listRef} className="docs-scrollbar flex-1 overflow-y-auto p-2" role="listbox" aria-label="Search results">
          {!index && !error ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground" aria-live="polite">Loading search index…</p>
          ) : error ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="alert">
              The search index could not be loaded. Refresh the page and try again.
            </p>
          ) : !query.trim() ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              <p className="mb-2 font-medium text-foreground">Try searching for…</p>
              <div className="flex flex-wrap gap-1.5">
                {["approve a prescription", "M-Pesa callback", "rider assignment", "loyalty points", "prescription model", "environment variables"].map((suggestion) => (
                  <button key={suggestion} type="button" className="docs-chip" onClick={() => setQuery(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
              <p className="mt-4 flex items-center gap-1.5 text-xs">
                <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
                Need a synthesized answer? Ask the <a className="underline" href="/docs/assistant" onClick={() => onOpenChange(false)}>documentation assistant</a>.
              </p>
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="status">
              No matches for “{query}”. Try different terms — or ask the assistant.
            </p>
          ) : (
            grouped.map(([kind, items]) => {
              const Icon = KIND_ICONS[kind]
              return (
                <div key={kind} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    {KIND_LABELS[kind]}
                  </p>
                  {items.map(({ entry, index }) => {
                    const titleParts = highlight(entry.t, terms)
                    const snippet = snippetFor(entry, terms)
                    return (
                      <button
                        key={`${entry.p}-${entry.a || "root"}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={selected === index}
                        data-index={index}
                        tabIndex={-1}
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => go(entry)}
                        className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                          selected === index ? "bg-accent" : "hover:bg-accent/60"
                        }`}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {titleParts.map((part, i) => (
                              part.hit ? <mark key={i} className="rounded-sm bg-accent px-0.5 text-foreground">{part.text}</mark> : <span key={i}>{part.text}</span>
                            ))}
                          </span>
                          {entry.h ? <span className="block truncate text-xs font-medium text-muted-foreground">{entry.h}</span> : null}
                          <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                            {snippet.split(new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")).map((part, i) =>
                              terms.some((t) => part.toLowerCase() === t) ? <mark key={i} className="rounded-sm bg-accent px-0.5 text-foreground">{part}</mark> : <span key={i}>{part}</span>,
                            )}
                          </span>
                        </span>
                        <span className="mt-1 shrink-0 text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                          {entry.k === "api" ? <Database className="h-3.5 w-3.5" aria-hidden /> : entry.c}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-[0.6875rem] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </span>
          <span>Indexed from docs/, openapi/ and prisma/</span>
        </div>
      </div>
    </div>
  )
}
