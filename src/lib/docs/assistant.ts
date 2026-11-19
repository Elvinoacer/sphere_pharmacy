import "server-only"

import { getCorpus, type DocRecord } from "./content"
import { parseOpenApi } from "./openapi"
import { parsePrismaSchema } from "./prisma-schema"
import { termVariants, tokenize } from "./search"
import { Slugger, plainText } from "./utils"

/**
 * Documentation AI assistant retrieval & deterministic synthesis layer.
 *
 * Security boundary (docs/security/ai-access-and-authorized-sessions.md):
 *   - Restricted to authenticated pharmacy staff (`requireStaff` on `/api/docs-assistant` and `/docs`).
 *   - Retrieves only from the documentation corpus (`docs/`, `openapi/sphere-api.yaml`, `prisma/schema.prisma`).
 *   - Never reads customer, order, prescription, or payment tables.
 *   - When `GROQ_API_KEY` is absent or unavailable, `synthesizeDocsAnswer()` produces a direct,
 *     multi-part, structure-preserving Markdown answer with inline citations `[1]`, `[2]` in <30 ms.
 */

export interface RetrievedSection {
  title: string
  heading: string
  url: string
  anchor: string
  category: string
  status: string
  snippet: string
  body: string
  score: number
}

interface IndexedChunk {
  title: string
  heading: string
  url: string
  anchor: string
  category: string
  status: string
  snippet: string
  body: string
  searchTitle: string
  searchHeading: string
  searchBody: string
}

const STOP_WORDS = new Set([
  "how", "does", "what", "are", "the", "for", "and", "with", "when", "where",
  "which", "can", "who", "why", "from", "into", "that", "this", "there",
  "have", "has", "had", "will", "would", "should", "could", "about", "tell",
  "explain", "show", "give", "work", "works", "working", "used", "use", "using",
])

let cachedChunks: IndexedChunk[] | null = null

function cleanStructuredBody(raw: string, maxChars = 1500): string {
  return raw
    .replace(/```mermaid[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*>\s*\*\*(?:Audience|Status|Last verified against code|Source of truth):\*\*.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars)
}

function cleanCardSnippet(raw: string): string {
  return raw
    .replace(/```mermaid[\s\S]*?```/g, "[diagram]")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*>\s*\*\*(?:Audience|Status|Last verified against code|Source of truth):\*\*.*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320)
}

function splitDocSections(doc: DocRecord): Array<{ heading: string; anchor: string; body: string }> {
  const lines = doc.body.split(/\r?\n/)
  const slugger = new Slugger()
  const sections: Array<{ heading: string; anchor: string; lines: string[] }> = []
  let current: { heading: string; anchor: string; lines: string[] } = {
    heading: doc.title,
    anchor: "",
    lines: [],
  }
  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line)
    if (match) {
      if (current.lines.length) sections.push(current)
      const level = match[1].length
      const text = plainText(match[2])
      const id = slugger.slug(text)
      current = { heading: text, anchor: level === 1 ? "" : id, lines: [] }
      continue
    }
    current.lines.push(line)
  }
  if (current.lines.length) sections.push(current)
  return sections.map((s) => ({ heading: s.heading, anchor: s.anchor, body: s.lines.join("\n") }))
}

function getIndexedChunks(): IndexedChunk[] {
  if (cachedChunks) return cachedChunks
  const chunks: IndexedChunk[] = []
  const corpus = getCorpus()

  for (const doc of corpus.docs) {
    const sections = splitDocSections(doc)
    const displayTitle = doc.journey ? `${doc.journey.id} · ${doc.title}` : doc.title
    for (const section of sections) {
      const structured = cleanStructuredBody(section.body)
      if (!structured || structured.length < 30) continue
      const cardSnippet = cleanCardSnippet(section.body)
      chunks.push({
        title: displayTitle,
        heading: section.heading,
        url: doc.url,
        anchor: section.anchor,
        category: doc.category,
        status: doc.status,
        snippet: cardSnippet,
        body: structured,
        searchTitle: `${displayTitle} ${doc.docsPath}`.toLowerCase(),
        searchHeading: section.heading.toLowerCase(),
        searchBody: structured.toLowerCase(),
      })
    }
  }

  // Index OpenAPI endpoints as structured chunks so route-specific questions hit exact contracts
  try {
    const api = parseOpenApi()
    for (const ep of api.endpoints) {
      const title = `OpenAPI · ${ep.method} ${ep.path}`
      const heading = ep.summary || `${ep.method} ${ep.path}`
      const paramsList = ep.parameters.length
        ? `\n- **Parameters:** ${ep.parameters.map((p) => `\`${p.name}\` (${p.in}${p.required ? ", required" : ""})`).join(", ")}`
        : ""
      const bodyText = [
        `- **Endpoint:** \`${ep.method} ${ep.path}\``,
        `- **Auth guard:** ${ep.auth}`,
        ep.rateLimit ? `- **Rate limit:** ${ep.rateLimit}` : "",
        ep.summary ? `- **Summary:** ${ep.summary}` : "",
        ep.description ? `- **Details:** ${ep.description}` : "",
        paramsList,
      ]
        .filter(Boolean)
        .join("\n")
      chunks.push({
        title: "API Reference (OpenAPI 3.1)",
        heading: `${ep.method} ${ep.path} — ${heading}`,
        url: "/docs/api-reference",
        anchor: ep.anchor,
        category: "api",
        status: "implemented",
        snippet: `${ep.method} ${ep.path} (${ep.auth}): ${ep.summary || ep.description}`.slice(0, 300),
        body: bodyText,
        searchTitle: `api reference openapi ${ep.method} ${ep.path} ${ep.tags.join(" ")}`.toLowerCase(),
        searchHeading: `${ep.method} ${ep.path} ${heading}`.toLowerCase(),
        searchBody: bodyText.toLowerCase(),
      })
    }
  } catch {
    // OpenAPI indexing is additive
  }

  // Index Prisma models as structured chunks so database/model questions hit exact fields
  try {
    const schema = parsePrismaSchema()
    for (const model of schema.models) {
      const keyFields = model.fields
        .slice(0, 14)
        .map((f) => `\`${f.name}\` (${f.type}${f.isList ? "[]" : ""}${f.isId ? ", PK" : ""}${f.isUnique ? ", unique" : ""})`)
        .join(", ")
      const bodyText = [
        `- **Prisma Model:** \`${model.name}\` (Domain: ${model.domain})`,
        model.comment ? `- **Purpose:** ${model.comment}` : "",
        `- **Fields (${model.fields.length}):** ${keyFields}`,
      ]
        .filter(Boolean)
        .join("\n")
      const anchor = `model-${model.name.toLowerCase()}`
      chunks.push({
        title: "Database Explorer (Prisma Schema)",
        heading: `${model.name} model (${model.domain})`,
        url: "/docs/database",
        anchor,
        category: "database",
        status: "implemented",
        snippet: `${model.name} (${model.domain}): ${keyFields}`.slice(0, 300),
        body: bodyText,
        searchTitle: `database prisma schema model ${model.name} ${model.domain}`.toLowerCase(),
        searchHeading: `${model.name} ${model.domain}`.toLowerCase(),
        searchBody: bodyText.toLowerCase(),
      })
    }
  } catch {
    // Prisma schema indexing is additive
  }

  cachedChunks = chunks
  return chunks
}

function extractDomainTerms(query: string): string[] {
  const all = tokenize(query)
  const filtered = all.filter((t) => !STOP_WORDS.has(t))
  return filtered.length > 0 ? filtered : all
}

export function retrieveSections(query: string, limit = 6, pageContext?: string): RetrievedSection[] {
  const terms = extractDomainTerms(query)
  if (!terms.length) return []

  const chunks = getIndexedChunks()
  const rawLower = query.toLowerCase().trim()
  const pageLower = pageContext?.toLowerCase().trim() || ""

  // Extract explicit identifiers like /api/..., SYS-11, P01, C01, ENV_VARS
  const explicitIds = [
    ...(query.match(/\/api\/[a-z0-9/_-]+/gi) ?? []),
    ...(query.match(/\b(?:SYS-\d{2}|[CPASR]\d{2}|T0[12])\b/gi) ?? []),
    ...(query.match(/\b[A-Z][A-Z0-9_]{4,}\b/g) ?? []),
  ].map((s) => s.toLowerCase())

  const scored: RetrievedSection[] = []

  for (const chunk of chunks) {
    let score = 0
    let matchedTerms = 0

    for (const term of terms) {
      const variants = termVariants(term)
      let termHit = false
      if (variants.some((v) => chunk.searchTitle.includes(v))) {
        score += 9
        termHit = true
      }
      if (variants.some((v) => chunk.searchHeading.includes(v))) {
        score += 7
        termHit = true
      }
      if (variants.some((v) => chunk.searchBody.includes(v))) {
        score += 3
        termHit = true
      }
      if (termHit) matchedTerms++
    }

    if (score === 0) continue

    // Coverage bonus when most/all domain terms match in the same section
    if (matchedTerms === terms.length) score += 10
    else if (terms.length > 2 && matchedTerms >= terms.length - 1) score += 5

    // Exact phrase match bonus
    if (terms.length >= 2) {
      const phrase = terms.join(" ")
      if (chunk.searchHeading.includes(phrase) || chunk.searchTitle.includes(phrase)) score += 14
      else if (chunk.searchBody.includes(phrase)) score += 8
    }
    if (rawLower.length > 5 && chunk.searchBody.includes(rawLower)) {
      score += 8
    }

    // Explicit identifier bonus (API route, journey ID, env var)
    for (const id of explicitIds) {
      if (chunk.searchTitle.includes(id) || chunk.searchHeading.includes(id)) score += 20
      else if (chunk.searchBody.includes(id)) score += 14
    }

    // Page context boost when user clicked "Ask Sphere Docs about this page"
    if (pageLower && (chunk.searchTitle.includes(pageLower) || chunk.url.toLowerCase().includes(pageLower))) {
      score += 12
    }

    scored.push({
      title: chunk.title,
      heading: chunk.heading,
      url: chunk.url,
      anchor: chunk.anchor,
      category: chunk.category,
      status: chunk.status,
      snippet: chunk.snippet,
      body: chunk.body,
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  // Diversify: at most 2 sections per document URL so complementary docs surface together
  const selected: RetrievedSection[] = []
  const perUrl = new Map<string, number>()
  for (const item of scored) {
    if (selected.length >= limit) break
    const count = perUrl.get(item.url) ?? 0
    if (count >= 2) continue
    perUrl.set(item.url, count + 1)
    selected.push(item)
  }

  return selected
}

/**
 * Formats retrieved sections into a compact, structure-preserving prompt context block.
 */
export function buildContext(sections: RetrievedSection[], maxChars = 6500): string {
  const parts: string[] = []
  let total = 0
  sections.forEach((section, index) => {
    const link = section.anchor ? `${section.url}#${section.anchor}` : section.url
    const block = `[${index + 1}] ${section.title} — ${section.heading} (${link}, status: ${section.status})\n${section.body}\n`
    if (total + block.length > maxChars) return
    parts.push(block)
    total += block.length
  })
  return parts.join("\n")
}

function scoreLineRelevance(line: string, terms: string[]): number {
  const lower = line.toLowerCase()
  let hits = 0
  for (const term of terms) {
    const variants = termVariants(term)
    if (variants.some((v) => lower.includes(v))) hits++
  }
  if (/\/api\/|`[A-Za-z0-9_.-]+`|\b(?:ADMIN|PHARMACIST|STAFF|RIDER|CUSTOMER)\b/.test(line)) {
    hits += 1
  }
  return hits
}

function extractReadablePoints(section: RetrievedSection, terms: string[], maxPoints = 4): string[] {
  const lines = section.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const points: Array<{ text: string; score: number }> = []

  for (const line of lines) {
    // Skip markdown table separator rows or bare code fences
    if (/^\|?[\s:-]+\|[\s|:-]*$/.test(line) || /^```/.test(line)) continue

    // Bullet or numbered list items
    const listMatch = /^(?:[-*+]|\d+\.)\s+(.+)$/.exec(line)
    if (listMatch) {
      const cleaned = listMatch[1].trim()
      if (cleaned.length >= 18 && cleaned.length <= 320) {
        points.push({ text: cleaned, score: scoreLineRelevance(cleaned, terms) + 2 })
      }
      continue
    }

    // Markdown table rows -> convert key columns into a readable bullet
    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
      if (
        cells.length >= 2 &&
        !/^(?:field|column|method|route|path|name|status|role|actor|step|key|variable)$/i.test(cells[0].replace(/[*_`]/g, ""))
      ) {
        const formatted = `**${cells[0].replace(/^\*\*|\*\*$/g, "")}:** ${cells.slice(1).join(" — ")}`
        if (formatted.length >= 15 && formatted.length <= 320) {
          points.push({ text: formatted, score: scoreLineRelevance(formatted, terms) + 1 })
        }
      }
      continue
    }

    // Standalone informative sentences/paragraphs
    if (line.length >= 35 && line.length <= 340 && !line.startsWith("#")) {
      points.push({ text: line, score: scoreLineRelevance(line, terms) })
    }
  }

  points.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const result: string[] = []
  for (const pt of points) {
    const key = pt.text.toLowerCase().slice(0, 60)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(pt.text)
    if (result.length >= maxPoints) break
  }
  return result
}

/**
 * Fast (<30 ms), structure-preserving deterministic answer synthesizer.
 * Produces a direct, multi-section Markdown answer with inline citations `[1]`, `[2]`
 * so "Ask Sphere Docs" is immediately useful even without an external LLM key.
 */
export function synthesizeDocsAnswer(question: string, sections: RetrievedSection[]): string {
  if (!sections.length) {
    return "I couldn’t find a matching section in the Sphere Pharmacy documentation corpus for that question. Try searching with specific terms like a route (`/api/orders`), model (`Prescription`, `PosOutboundJob`), journey ID (`P01`, `SYS-11`), or feature name."
  }

  const terms = extractDomainTerms(question)
  const top = sections[0]
  const topLink = top.anchor ? `${top.url}#${top.anchor}` : top.url
  const topHeading = top.heading && top.heading !== top.title ? ` (${top.heading})` : ""

  // Extract a direct lead paragraph from section [1]
  const leadParagraphs = top.body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 40 && !p.startsWith("|") && !p.startsWith("```"))

  const bestLead =
    leadParagraphs
      .map((p) => ({ p, s: scoreLineRelevance(p, terms) }))
      .sort((a, b) => b.s - a.s)[0]?.p || top.snippet

  const cleanLead = bestLead.replace(/^(?:[-*+]|\d+\.)\s+/, "").slice(0, 420)

  // Collect structured bullet points across the top 4 retrieved sections
  const bullets: string[] = []
  const usedKeys = new Set<string>([cleanLead.toLowerCase().slice(0, 60)])

  sections.slice(0, 4).forEach((sec, idx) => {
    const cite = `[${idx + 1}]`
    const pts = extractReadablePoints(sec, terms, idx === 0 ? 3 : 2)
    for (const pt of pts) {
      const key = pt.toLowerCase().slice(0, 60)
      if (usedKeys.has(key)) continue
      usedKeys.add(key)
      bullets.push(`- ${pt} ${cite}`)
    }
  })

  const envDependent = sections
    .slice(0, 4)
    .filter((s) => s.status === "environment-dependent")

  const parts: string[] = [
    `Based on **[${top.title}](${topLink})**${topHeading} [1]:`,
    "",
    `${cleanLead} [1]`,
  ]

  if (bullets.length > 0) {
    parts.push("", "### Key details from the documentation", ...bullets.slice(0, 6))
  }

  if (envDependent.length > 0) {
    parts.push(
      "",
      `> **Environment note:** ${envDependent[0].title} is marked \`environment-dependent\` — live execution requires the corresponding external provider credentials in \`.env\`.`,
    )
  }

  const sourceLinks = sections.slice(0, 4).map((sec, idx) => {
    const href = sec.anchor ? `${sec.url}#${sec.anchor}` : sec.url
    const where = sec.heading && sec.heading !== sec.title ? ` — *${sec.heading}*` : ""
    return `${idx + 1}. **[${sec.title}](${href})**${where}`
  })

  parts.push("", "### Cited sections", ...sourceLinks)

  return parts.join("\n")
}

export const ASSISTANT_SYSTEM_PROMPT = [
  "You are the Sphere Pharmacy Documentation Assistant for authenticated pharmacy staff, pharmacists, engineers, and administrators.",
  "You answer questions strictly using the numbered documentation excerpts provided under CONTEXT.",
  "Rules:",
  "1. Ground every statement in the CONTEXT. Cite sources inline as [1], [2], etc. matching the numbered context blocks, and link key pages using Markdown links like [Title](/docs/...).",
  "2. Be direct, fast to scan, and actionable: start with a clear 1-2 sentence summary, then use concise bullet points or numbered steps including exact API routes (`/api/...`), guards (`requireStaff`, `requireCustomer`), Prisma models, or environment variable names when present in CONTEXT.",
  "3. If a feature or journey has status 'environment-dependent', explicitly note which external credentials or services are required.",
  "4. Never invent routes, environment variables, database columns, or roles not shown in the CONTEXT.",
  "5. Never ask for or output real credentials, customer data, or prescription contents.",
].join("\n")
