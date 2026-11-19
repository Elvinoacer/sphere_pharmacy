import "server-only"

/**
 * Minimal YAML-frontmatter parser for the subset used by docs/journeys/**.
 * Supported: scalar values, quoted scalars, inline arrays [a, b], and block
 * arrays ("- item" lines). Anything unparseable is returned as a raw string.
 */

export type FrontmatterValue = string | string[]

export interface ParsedFrontmatter {
  data: Record<string, FrontmatterValue>
  body: string
}

function unquote(value: string): string {
  const t = value.trim()
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1)
  }
  return t
}

function parseInlineArray(value: string): string[] | null {
  const t = value.trim()
  if (!t.startsWith("[") || !t.endsWith("]")) return null
  const inner = t.slice(1, -1).trim()
  if (!inner) return []
  // Split on commas that are not inside quotes.
  const items: string[] = []
  let current = ""
  let quote: string | null = null
  for (const ch of inner) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ",") {
      items.push(current)
      current = ""
      continue
    }
    current += ch
  }
  if (current.trim()) items.push(current)
  return items.map(unquote).filter(Boolean)
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) return { data: {}, body: normalized }
  const end = normalized.indexOf("\n---", 4)
  if (end === -1) return { data: {}, body: normalized }
  // Find the end of the closing fence (must be a line on its own).
  let closeEnd = end
  const lineEnd = normalized.indexOf("\n", end + 1)
  const fenceLine = normalized.slice(end + 1, lineEnd === -1 ? undefined : lineEnd).trim()
  if (fenceLine !== "---") return { data: {}, body: normalized }
  closeEnd = lineEnd === -1 ? normalized.length : lineEnd + 1

  const yamlBlock = normalized.slice(4, end)
  const body = normalized.slice(closeEnd).replace(/^\n+/, "")
  const data: Record<string, FrontmatterValue> = {}
  const lines = yamlBlock.split("\n")
  let currentKey: string | null = null
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    if (/^\s+-\s+/.test(line)) {
      if (currentKey) {
        const item = unquote(line.trim().replace(/^-\s+/, ""))
        if (item) {
          const existing = data[currentKey]
          if (Array.isArray(existing)) existing.push(item)
          else data[currentKey] = [item]
        }
      }
      continue
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (kv) {
      const key = kv[1]
      const value = kv[2].trim()
      currentKey = key
      if (!value) {
        data[key] = []
      } else {
        const arr = parseInlineArray(value)
        data[key] = arr ?? unquote(value)
      }
    }
  }
  return { data, body }
}

/** Normalize a status label from either frontmatter or a metadata table. */
export function normalizeStatus(raw: string | undefined): DocStatus {
  if (!raw) return "implemented"
  const t = raw.toLowerCase()
  if (t.includes("environment-dependent") || t.includes("environment dependent")) return "environment-dependent"
  if (t.includes("planned") || t.includes("not shipped")) return "planned"
  if (t.includes("requires live verification") || t.includes("live verification")) return "needs-verification"
  if (t.includes("implemented")) return "implemented"
  return "implemented"
}

export type DocStatus = "implemented" | "environment-dependent" | "planned" | "needs-verification"

/**
 * Extract the `| Audience | Status | Verified |` metadata table used by the
 * original docs corpus. Returns null fields when absent.
 */
export function parseMetadataTable(body: string): {
  audience: string[] | null
  status: DocStatus | null
  verified: string | null
} {
  const head = body.split("\n").slice(0, 60).join("\n")
  const rows = [...head.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/gm)]
  let audience: string[] | null = null
  let status: DocStatus | null = null
  let verified: string | null = null
  for (const row of rows) {
    const key = row[1].toLowerCase().replace(/\*\*/g, "").trim()
    const value = row[2].replace(/\*\*/g, "").trim()
    if (key === "audience") {
      audience = value
        .split(/[,/&]| and /i)
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (key === "status") {
      status = normalizeStatus(value)
    } else if (key === "verified") {
      verified = value || null
    }
  }
  return { audience, status, verified }
}
