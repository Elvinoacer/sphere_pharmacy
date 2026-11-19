import "server-only"

import { getCorpus, type DocRecord } from "./content"
import { parseOpenApi } from "./openapi"
import type { DocHeading } from "./utils"

/**
 * Build-time lexical search index for the documentation portal.
 * Serialized as JSON and served by GET /api/docs-index; the command palette
 * (client) fetches it once and searches locally — search keeps working even
 * when AI services are unavailable.
 */

export interface SearchEntry {
  /** document title */
  t: string
  /** portal URL of the document */
  p: string
  /** section heading ("" for the document entry) */
  h: string
  /** anchor within the document ("" for the document entry) */
  a: string
  /** kind: doc | journey | role | api */
  k: "doc" | "journey" | "role" | "api"
  /** audience tags */
  g: string[]
  /** category id */
  c: string
  /** status */
  s: string
  /** searchable body text (trimmed) */
  b: string
}

export interface SearchIndex {
  v: 1
  generatedAt: string
  entries: SearchEntry[]
}

const BODY_LIMIT = 900
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be", "with", "as", "by", "at", "it",
  "this", "that", "from", "how", "what", "when", "which", "do", "does", "can", "i", "you", "we", "my",
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()#>|-]/g, " ")
    .split(/[^a-z0-9.:/+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Light suffix-stripping so “cancels” matches “cancel”/“cancelled”/“cancellation”. */
export function termVariants(term: string): string[] {
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

function sectionBody(doc: DocRecord, heading: DocHeading | null, next: DocHeading | null): string {
  if (!heading) {
    // Document-level entry: text up to the first h2.
    const idx = doc.body.indexOf("\n## ")
    return doc.body.slice(0, idx === -1 ? 2400 : idx)
  }
  const start = doc.body.indexOf(`\n### ${heading.text}`) !== -1
    ? doc.body.indexOf(`\n### ${heading.text}`)
    : doc.body.indexOf(`\n${"#".repeat(heading.level)} ${heading.text}`)
  if (start === -1) {
    const alt = doc.body.indexOf(`${"#".repeat(heading.level)} ${heading.text}`)
    if (alt === -1) return ""
    return doc.body.slice(alt, alt + 2400)
  }
  let end = doc.body.length
  if (next) {
    const nextIdx = doc.body.indexOf(`\n${"#".repeat(next.level)} ${next.text}`)
    if (nextIdx > start) end = nextIdx
  }
  return doc.body.slice(start, Math.min(end, start + 2600))
}

function cleanBody(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\|.*\|$/gm, (row) => row.replace(/\|/g, " ").trim())
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BODY_LIMIT)
}

let indexCache: SearchIndex | null = null

export function getSearchIndex(): SearchIndex {
  if (indexCache) return indexCache
  const corpus = getCorpus()
  const entries: SearchEntry[] = []

  for (const doc of corpus.docs) {
    const kind: SearchEntry["k"] = doc.isJourney
      ? doc.docsPath.startsWith("journeys/roles/")
        ? "role"
        : doc.docsPath === "journeys/README"
          ? "doc"
          : "journey"
      : "doc"
    const label = doc.isJourney && doc.journey && doc.docsPath !== "journeys/README"
      ? `${doc.journey.id} · ${doc.title}`
      : doc.title
    entries.push({
      t: label,
      p: doc.url,
      h: "",
      a: "",
      k: kind,
      g: doc.audience,
      c: doc.category,
      s: doc.status,
      b: cleanBody(doc.body).slice(0, BODY_LIMIT),
    })
    const headings = doc.headings.filter((h) => h.level <= 3)
    headings.forEach((heading, i) => {
      const next = headings[i + 1] ?? null
      const body = cleanBody(sectionBody(doc, heading, next))
      if (!body) return
      entries.push({
        t: label,
        p: doc.url,
        h: heading.text,
        a: heading.id,
        k: kind,
        g: doc.audience,
        c: doc.category,
        s: doc.status,
        b: body.slice(0, BODY_LIMIT),
      })
    })
  }

  // API endpoints are first-class search citizens.
  try {
    const api = parseOpenApi()
    for (const endpoint of api.endpoints) {
      entries.push({
        t: `${endpoint.method} ${endpoint.path}`,
        p: "/docs/api-reference",
        h: endpoint.summary,
        a: endpoint.anchor,
        k: "api",
        g: ["engineering"],
        c: "api",
        s: "implemented",
        b: cleanBody(`${endpoint.summary}. ${endpoint.description} ${endpoint.tags.join(" ")}`).slice(0, 400),
      })
    }
  } catch {
    // OpenAPI is optional for search; the reference page reports errors explicitly.
  }

  indexCache = { v: 1, generatedAt: new Date().toISOString(), entries }
  return indexCache
}

/** Lexical relevance scoring used by both the palette and the AI retrieval. */
export function scoreEntry(entry: SearchEntry, terms: string[]): number {
  if (!terms.length) return 0
  const title = entry.t.toLowerCase()
  const heading = (entry.h || "").toLowerCase()
  const body = entry.b.toLowerCase()
  const expanded = terms.map(termVariants)
  let score = 0
  let matched = 0
  for (const variants of expanded) {
    let hit = false
    if (variants.some((v) => title === v)) { score += 14; hit = true }
    else if (variants.some((v) => title.includes(v))) { score += 8; hit = true }
    if (variants.some((v) => heading.includes(v))) { score += 5; hit = true }
    if (variants.some((v) => body.includes(v))) { score += 2; hit = true }
    if (entry.k === "api" && /^api$|^post$|^get$|^patch$|^delete$|^put$/.test(variants[0])) { score += 1 }
    if (hit) matched++
  }
  if (matched === terms.length) score += 6 // full coverage bonus
  return score
}

export function searchEntries(query: string, limit = 12): Array<{ entry: SearchEntry; score: number }> {
  const terms = tokenize(query)
  if (!terms.length) return []
  const index = getSearchIndex()
  const scored: Array<{ entry: SearchEntry; score: number }> = []
  for (const entry of index.entries) {
    const score = scoreEntry(entry, terms)
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score || a.entry.t.localeCompare(b.entry.t))
  return scored.slice(0, limit)
}
