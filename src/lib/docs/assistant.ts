import "server-only"

import { getCorpus } from "./content"
import { tokenize, termVariants } from "./search"

/**
 * Retrieval layer for the documentation AI assistant ("Ask Sphere Docs").
 * Heading-aware chunking + lexical scoring over the canonical corpus. The
 * corpus is public reference documentation only — never account data — so
 * retrieval respects the project's AI access policy by construction.
 */

export interface RetrievedSection {
  title: string
  url: string
  heading: string
  anchor: string
  snippet: string
  score: number
}

const CONTEXT_CHAR_BUDGET = 9000

export function retrieveSections(query: string, limit = 6): RetrievedSection[] {
  const terms = tokenize(query)
  if (!terms.length) return []
  const corpus = getCorpus()
  const results: RetrievedSection[] = []

  for (const doc of corpus.docs) {
    const docTerms = `${doc.title} ${doc.description}`.toLowerCase()
    let docScore = 0
    for (const term of terms) {
      if (docTerms.includes(term)) docScore += 2
    }
    const headings = doc.headings.filter((h) => h.level <= 3)
    const candidates: Array<{ heading: string; anchor: string; body: string; score: number }> = []
    headings.forEach((heading, i) => {
      const next = headings[i + 1] ?? null
      let start = doc.body.indexOf(`\n${"#".repeat(heading.level)} ${heading.text}`)
      if (start === -1) start = doc.body.indexOf(`${"#".repeat(heading.level)} ${heading.text}`)
      if (start === -1) return
      let end = doc.body.length
      if (next) {
        const nextIdx = doc.body.indexOf(`\n${"#".repeat(next.level)} ${next.text}`)
        if (nextIdx > start) end = nextIdx
      }
      const body = doc.body.slice(start, end)
      const lower = body.toLowerCase()
      let score = 0
      for (const term of terms) {
        const variants = termVariants(term)
        if (variants.some((v) => heading.text.toLowerCase().includes(v))) score += 6
        const occurrences = variants.reduce((sum, v) => sum + (lower.split(v).length - 1), 0)
        if (occurrences > 0) score += Math.min(6, 1 + occurrences * 0.4)
      }
      if (score > 0) {
        candidates.push({ heading: heading.text, anchor: heading.id, body, score: score + docScore })
      }
    })
    if (!candidates.length && docScore > 0) {
      // Document is relevant but no single heading matched — use the intro.
      candidates.push({
        heading: doc.title,
        anchor: "",
        body: doc.body.split("\n## ")[0],
        score: docScore,
      })
    }
    // Exact-id boost: a question mentioning a journey ID should surface that journey.
    const idMatch = terms.find((term) => /^[opcxshatr]\d{2}$/.test(term))
    if (idMatch) {
      const byId = corpus.journeys.find((j) => j.journey?.id.toLowerCase() === idMatch)
      if (byId) {
        candidates.push({ heading: byId.title, anchor: "", body: byId.body.split("\n## ")[1] ?? byId.body.slice(0, 2000), score: 40 })
      }
    }
    for (const candidate of candidates) {
      results.push({
        title: doc.isJourney && doc.journey ? `${doc.journey.id} · ${doc.title}` : doc.title,
        url: doc.url,
        heading: candidate.heading,
        anchor: candidate.anchor,
        snippet: candidate.body,
        score: candidate.score,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  // Diversify: at most 2 sections from the same document in the top set.
  const perDoc = new Map<string, number>()
  const selected: RetrievedSection[] = []
  for (const result of results) {
    const count = perDoc.get(result.url) ?? 0
    if (count >= 2) continue
    perDoc.set(result.url, count + 1)
    selected.push({ ...result, snippet: cleanSnippet(result.snippet) })
    if (selected.length >= limit) break
  }
  return selected
}

function cleanSnippet(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1400)
}

export function buildContext(sections: RetrievedSection[]): string {
  const parts: string[] = []
  let used = 0
  sections.forEach((section, index) => {
    if (used >= CONTEXT_CHAR_BUDGET) return
    const room = CONTEXT_CHAR_BUDGET - used
    const body = section.snippet.slice(0, room)
    used += body.length
    parts.push(
      `[[${index + 1}]] Document: ${section.title}${section.heading && section.heading !== section.title ? ` — section: ${section.heading}` : ""}\nURL: ${section.url}${section.anchor ? `#${section.anchor}` : ""}\n${body}`,
    )
  })
  return parts.join("\n\n---\n\n")
}

export const ASSISTANT_SYSTEM_PROMPT = `You are "Ask Sphere Docs", the documentation assistant for Sphere Pharmacy — a full-stack retail pharmacy operations platform (Next.js 16 SPA, React 19, PostgreSQL + Prisma 6, Tailwind/shadcn, Zustand) for a community pharmacy in Roysambu, Nairobi, Kenya.

You answer questions about the platform using ONLY the retrieved documentation excerpts provided by the user message. Citations are mandatory: after any factual statement, add [n] referencing the excerpt number.

Rules:
- Answer directly and concisely in Markdown. Use short paragraphs and lists.
- Ground every claim in the excerpts. If the excerpts do not answer the question, say so plainly and suggest what to search for.
- Distinguish implemented behaviour from environment-dependent behaviour (features that need live provider credentials such as M-Pesa Daraja, IntaSend, Resend, FCM, Groq, R2) and from planned/not-shipped functionality, exactly as the excerpts state.
- Never invent API endpoints, permission rules, database fields, file paths or status values.
- If a question touches account-scoped data (customer records, prescription contents, staff information), explain that the documentation covers the behaviour but account data is only accessible within authorized sessions per the platform's AI access policy.
- Prefer citing the most specific section. Cite like [1] or [2][3].
- Keep answers under 250 words unless the question demands more.

End with a line: "Sources: [n] …" listing the excerpt numbers you used.`
