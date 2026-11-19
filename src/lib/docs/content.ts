import "server-only"

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, posix } from "node:path"
import { parseFrontmatter, parseMetadataTable, type DocStatus, type FrontmatterValue } from "./frontmatter"
import { extractHeadings, plainText, type DocHeading } from "./utils"

/**
 * The documentation registry. Reads the canonical corpus once (per process)
 * and exposes typed records for pages, navigation, search and AI retrieval.
 *
 * Corpus:
 *  - every Markdown file under docs/ (categories, journeys, recording, reference)
 *  - README.md and AGENTS.md at the repo root (virtual "project" category)
 */

const ROOT = process.cwd()

export type Audience = "operations" | "engineering" | "administration"

export interface JourneyMeta {
  id: string
  actor: string
  secondaryActors: string[]
  area: string
  entryPoint: string
  objective: string
  startCondition: string
  endCondition: string
  relatedJourneys: string[]
  relatedDocs: string[]
  recordingRefs: string[]
  status: DocStatus
  verified: string
  evidence: string
}

export interface DocRecord {
  /** Portal URL path, e.g. /docs/architecture/system-architecture */
  url: string
  /** Repo-relative source path, e.g. docs/architecture/system-architecture.md */
  sourcePath: string
  /** Virtual docs-relative path without extension (identity), e.g. architecture/system-architecture */
  docsPath: string
  title: string
  description: string
  category: string
  /** true for docs/journeys/** (journey or role documents) */
  isJourney: boolean
  journey: JourneyMeta | null
  audience: Audience[]
  status: DocStatus
  verified: string | null
  headings: DocHeading[]
  /** Markdown body without frontmatter */
  body: string
  wordCount: number
}

interface Corpus {
  docs: DocRecord[]
  byUrl: Map<string, DocRecord>
  byDocsPath: Map<string, DocRecord>
  bySourcePath: Map<string, DocRecord>
  journeys: DocRecord[]
  roleOverviews: DocRecord[]
}

const CATEGORY_AUDIENCE: Record<string, Audience[]> = {
  product: ["operations"],
  architecture: ["engineering"],
  features: ["engineering"],
  database: ["engineering"],
  api: ["engineering"],
  integrations: ["engineering"],
  security: ["engineering"],
  workflows: ["engineering", "operations"],
  operations: ["administration"],
  testing: ["engineering"],
  governance: ["administration"],
  recording: ["operations"],
  reference: ["operations", "administration"],
  project: ["engineering"],
}

const CATEGORY_ORDER = [
  "product",
  "architecture",
  "features",
  "database",
  "api",
  "integrations",
  "security",
  "workflows",
  "operations",
  "testing",
  "governance",
  "recording",
  "reference",
  "project",
]

function walk(dir: string, base: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, base ? `${base}/${entry}` : entry, out)
    } else if (entry.endsWith(".md")) {
      out.push(base ? `${base}/${entry}` : entry)
    }
  }
}

function firstParagraph(body: string): string {
  const lines = body.split("\n")
  let started = false
  const para: string[] = []
  for (const line of lines) {
    if (!line.trim()) {
      if (started) break
      continue
    }
    if (line.startsWith("#")) {
      if (started) break
      continue
    }
    if (line.startsWith("|") || line.startsWith("```")) {
      if (started) break
      continue
    }
    started = true
    para.push(line.trim())
  }
  return plainText(para.join(" ")).slice(0, 240)
}

function asArray(value: FrontmatterValue | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function toUrl(docsPath: string): string {
  const parts = docsPath.split("/")
  const last = parts[parts.length - 1]
  parts[parts.length - 1] = last.toLowerCase()
  return `/docs/${parts.join("/")}`
}

function resolveDocSource(sourcePath: string): string {
  if (sourcePath === "README.md") return join(ROOT, "README.md")
  if (sourcePath === "AGENTS.md") return join(ROOT, "AGENTS.md")
  const rel = sourcePath.startsWith("docs/") ? sourcePath.slice("docs/".length) : sourcePath
  return join(ROOT, "docs", rel)
}

function loadDoc(sourcePath: string, docsPath: string): DocRecord | null {
  const absolute = resolveDocSource(sourcePath)
  if (!existsSync(absolute)) return null
  const raw = readFileSync(absolute, "utf8")
  const { data, body } = parseFrontmatter(raw)

  const titleMatch = /^#\s+(.+)$/m.exec(body)
  const title = titleMatch ? plainText(titleMatch[1]) : docsPath.split("/").pop() || docsPath
  const isJourney = docsPath.startsWith("journeys/")
  const segments = docsPath.split("/")
  const category = isJourney ? "journeys" : segments.length === 1 ? "reference" : segments[0]

  let journey: JourneyMeta | null = null
  if (isJourney && data.id) {
    journey = {
      id: String(data.id),
      actor: String(data.actor || "System"),
      secondaryActors: asArray(data.secondaryActors),
      area: String(data.area || "General"),
      entryPoint: String(data.entryPoint || ""),
      objective: String(data.objective || ""),
      startCondition: String(data.startCondition || ""),
      endCondition: String(data.endCondition || ""),
      relatedJourneys: asArray(data.relatedJourneys),
      relatedDocs: asArray(data.relatedDocs),
      recordingRefs: asArray(data.recordingRefs),
      status: (String(data.status || "implemented") as DocStatus) || "implemented",
      verified: String(data.verified || ""),
      evidence: String(data.evidence || ""),
    }
  }

  const tableMeta = parseMetadataTable(body)
  const fmStatus = data.status ? (String(data.status) as DocStatus) : null
  const status: DocStatus = journey?.status ?? fmStatus ?? tableMeta.status ?? "implemented"
  const verified = String(data.verified || "") || tableMeta.verified || null
  const audienceFromTable = tableMeta.audience
  const audience: Audience[] = audienceFromTable
    ? dedupe(audienceFromTable.map(mapAudience))
    : CATEGORY_AUDIENCE[category] ?? ["engineering"]

  return {
    url: toUrl(docsPath),
    sourcePath,
    docsPath,
    title,
    description: String(data.objective || "") || firstParagraph(body),
    category,
    isJourney,
    journey,
    audience,
    status,
    verified,
    headings: extractHeadings(body),
    body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  }
}

function mapAudience(raw: string): Audience {
  const t = raw.toLowerCase()
  if (t.includes("operator") || t.includes("pharmacy") || t.includes("owner") || t.includes("rider") || t.includes("staff") || t.includes("customer") || t.includes("all")) {
    return "operations"
  }
  if (t.includes("admin") || t.includes("governance") || t.includes("infrastructure") || t.includes("deployment")) {
    return "administration"
  }
  return "engineering"
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)]
}

let corpusCache: Corpus | null = null

export function getCorpus(): Corpus {
  if (corpusCache) return corpusCache
  const docsDir = join(ROOT, "docs")
  const files = walkToDocs(docsDir)
  const docs: DocRecord[] = []

  for (const docsPath of files) {
    if (docsPath === "README.md") continue // rendered as /docs/readme below
    const doc = loadDoc(joinPath("docs", docsPath), docsPath.replace(/\.md$/, ""))
    if (doc) docs.push(doc)
  }
  // docs/README.md → /docs/readme (the documentation index)
  const readme = loadDoc("docs/README.md", "readme")
  if (readme) docs.push(readme)
  // Repo-root guides as virtual project documents.
  const agents = loadDoc("AGENTS.md", "project/agents")
  if (agents) docs.push(agents)
  const rootReadme = loadDoc("README.md", "project/readme")
  if (rootReadme) docs.push(rootReadme)

  const byUrl = new Map(docs.map((d) => [d.url, d]))
  const byDocsPath = new Map(docs.map((d) => [d.docsPath, d]))
  const bySourcePath = new Map(docs.map((d) => [d.sourcePath, d]))
  const journeys = docs.filter((d) => d.isJourney && d.journey && !d.docsPath.startsWith("journeys/roles") && d.docsPath !== "journeys/README")
  const roleOverviews = docs.filter((d) => d.docsPath.startsWith("journeys/roles/"))

  corpusCache = { docs, byUrl, byDocsPath, bySourcePath, journeys, roleOverviews }
  return corpusCache
}

function joinPath(...parts: string[]): string {
  return parts.join("/")
}

function walkToDocs(dir: string): string[] {
  const out: string[] = []
  walk(dir, "", out)
  return out
}

export function getDoc(url: string): DocRecord | null {
  return getCorpus().byUrl.get(url) ?? null
}

export function getDocBySource(sourcePath: string): DocRecord | null {
  return getCorpus().bySourcePath.get(sourcePath) ?? null
}

/**
 * Resolve a markdown link target against a document's source location and
 * return the portal URL, or null when the target is not a portal document.
 */
export function resolveDocLink(href: string, doc: DocRecord): string | null {
  if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:") || href.startsWith("tel:")) return null
  const hashIndex = href.indexOf("#")
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const hashPart = hashIndex === -1 ? "" : href.slice(hashIndex)

  if (!pathPart || pathPart === ".") {
    return hashPart || doc.url
  }
  if (pathPart === "openapi/sphere-api.yaml") return "/docs/api-reference"

  // Resolve relative to the document's real directory (works for docs/** and repo-root files).
  const sourceDir = posix.dirname(doc.sourcePath)
  const normalizedPosix = posix.normalize(posix.join(sourceDir, pathPart))

  // Exact source match (README.md, AGENTS.md, docs/**)
  const bySource = getCorpus().bySourcePath.get(normalizedPosix)
  if (bySource) return bySource.url + hashPart
  // Docs-relative match (links written relative to docs/)
  const byDocs = getCorpus().byDocsPath.get(normalizedPosix.replace(/\.md$/, "").replace(/^docs\//, ""))
  if (byDocs) return byDocs.url + hashPart
  // Directory index links (e.g. docs/recording/) — route to first doc in folder if it exists
  if (!pathPart.endsWith(".md")) return null
  return null
}

export interface CorpusStats {
  totalDocs: number
  journeys: number
  roleOverviews: number
  mermaidDiagrams: number
  apiEndpoints: number
  dbModels: number
  categories: Array<{ id: string; count: number }>
  verifiedDates: string[]
}

export function getCorpusStats(apiEndpoints: number, dbModels: number): CorpusStats {
  const corpus = getCorpus()
  const mermaidDiagrams = corpus.docs.reduce(
    (sum, d) => sum + (d.body.match(/```mermaid/g)?.length ?? 0),
    0,
  )
  const categoryCounts = new Map<string, number>()
  for (const doc of corpus.docs) {
    categoryCounts.set(doc.category, (categoryCounts.get(doc.category) ?? 0) + 1)
  }
  const verifiedDates = dedupe(
    corpus.docs.map((d) => d.verified).filter((v): v is string => Boolean(v)),
  )
  const categories = CATEGORY_ORDER.filter((c) => categoryCounts.has(c)).map((id) => ({
    id,
    count: categoryCounts.get(id) ?? 0,
  }))
  return {
    totalDocs: corpus.docs.length,
    journeys: corpus.journeys.length,
    roleOverviews: corpus.roleOverviews.length,
    mermaidDiagrams,
    apiEndpoints,
    dbModels,
    categories,
    verifiedDates,
  }
}

export { CATEGORY_ORDER }
