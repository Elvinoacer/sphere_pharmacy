import "server-only"

/**
 * Documentation corpus pipeline — shared utilities.
 * The `docs/` directory (plus two repo-root guides) is the single source of
 * truth; this module reads it at build time and never mutates it.
 */

/** GitHub-style heading slug with dedup suffixes (-1, -2, …). */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Deduplicating slugger: same visible text maps to the same id. */
export class Slugger {
  private seen = new Map<string, number>()
  slug(text: string): string {
    const base = slugifyHeading(text) || "section"
    const n = this.seen.get(base) ?? 0
    this.seen.set(base, n + 1)
    return n === 0 ? base : `${base}-${n}`
  }
}

/** Strip markdown emphasis/links from heading text for anchor + TOC display. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim()
}

export interface DocHeading {
  level: number
  text: string
  id: string
}

/** Extract h2/h3 (and h4) headings with stable anchors, mirroring the renderer. */
export function extractHeadings(markdown: string): DocHeading[] {
  const slugger = new Slugger()
  const headings: DocHeading[] = []
  const lines = markdown.split("\n")
  let inFence = false
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{2,4})\s+(.+?)\s*$/.exec(line)
    if (m) {
      const text = plainText(m[2])
      headings.push({ level: m[1].length, text, id: slugger.slug(text) })
    }
  }
  return headings
}
