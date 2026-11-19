import { NextResponse } from "next/server"
import { enforceRateLimit, rejectOversizedRequest } from "@/lib/security/request"
import { requireStaff } from "@/lib/session"
import {
  ASSISTANT_SYSTEM_PROMPT,
  buildContext,
  retrieveSections,
  synthesizeDocsAnswer,
  type RetrievedSection,
} from "@/lib/docs/assistant"

/**
 * Staff-only documentation AI assistant endpoint ("Ask Sphere Docs").
 *
 * Security boundary (docs/security/ai-access-and-authorized-sessions.md):
 *   - Restricted to authenticated pharmacy staff via `requireStaff()`.
 *   - Retrieves strictly from the documentation corpus (`docs/`, `openapi/`, `prisma/`).
 *   - Never reads customer, order, prescription, or payment records.
 *   - Provider: Groq (`GROQ_API_KEY` / `GROQ_MODEL`), with fast deterministic synthesis fallback.
 */

interface IncomingMessage {
  role: "user" | "assistant"
  content: string
}

interface Citation {
  index: number
  title: string
  heading: string
  url: string
  anchor: string
  category: string
  status: string
  snippet: string
}

function toCitations(sections: RetrievedSection[]): Citation[] {
  return sections.map((section, idx) => ({
    index: idx + 1,
    title: section.title,
    heading: section.heading,
    url: section.url,
    anchor: section.anchor,
    category: section.category,
    status: section.status,
    snippet: section.snippet,
  }))
}

export async function POST(request: Request) {
  const { error } = await requireStaff()
  if (error) return error

  const headers = { "Cache-Control": "private, no-store" }

  const tooLarge = rejectOversizedRequest(request, 24_000)
  if (tooLarge) return tooLarge

  const limited = await enforceRateLimit(request, "docs-assistant", 40, 60 * 60_000)
  if (limited) return limited

  let body: { messages?: unknown; pageContext?: unknown }
  try {
    body = (await request.json()) as { messages?: unknown; pageContext?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers })
  }

  const pageContext =
    typeof body?.pageContext === "string" ? body.pageContext.slice(0, 200).trim() : undefined

  const raw = Array.isArray(body?.messages) ? body.messages : []
  const messages: IncomingMessage[] = raw
    .filter(
      (m: { role?: unknown; content?: unknown }): m is IncomingMessage =>
        Boolean(m) &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1200).trim() }))

  const last = [...messages].reverse().find((m) => m.role === "user")
  if (!last) {
    return NextResponse.json(
      {
        reply:
          "Ask a question about Sphere Pharmacy — user journeys, operational workflows, architecture, API routes, database models, integrations or deployment.",
        citations: [],
        synthesized: false,
      },
      { headers },
    )
  }

  if (hasCredential(last.content)) {
    return NextResponse.json(
      {
        reply:
          "Please do not paste credentials, API keys, tokens or passwords into the documentation assistant. Ask your question without the secret value and I will point you to the relevant configuration guide.",
        citations: [],
        synthesized: false,
      },
      { headers },
    )
  }

  const sections = retrieveSections(last.content, 6, pageContext)
  const citations = toCitations(sections)
  const apiKey = process.env.GROQ_API_KEY?.trim()

  if (apiKey && sections.length > 0) {
    try {
      const context = buildContext(sections)
      const contextHeader = pageContext
        ? `CURRENT PAGE CONTEXT: ${pageContext}\n\nCONTEXT:\n${context}`
        : `CONTEXT:\n${context}`

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
          messages: [
            { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
            { role: "system", content: contextHeader },
            ...messages,
          ],
          temperature: 0.2,
          max_completion_tokens: 1200,
          stream: false,
        }),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      })

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const reply = data?.choices?.[0]?.message?.content?.trim()
        if (reply && !hasCredential(reply)) {
          return NextResponse.json({ reply, citations, synthesized: true }, { headers })
        }
      }
    } catch {
      // Fall through to fast deterministic synthesis
    }
  }

  // Fast deterministic synthesis when GROQ_API_KEY is unset or unavailable.
  const reply = synthesizeDocsAnswer(last.content, sections)
  return NextResponse.json({ reply, citations, synthesized: false }, { headers })
}

function hasCredential(text: string): boolean {
  if (/\b(?:gsk_|sk-)[A-Za-z0-9_-]{12,}\b/.test(text)) return true
  // Reject actual secret assignments while allowing uppercase env-var placeholders like BANDAGO_SYNC_API_KEY
  const match = /\b(?:password|api[_-]?key|pin|otp)\s*[:=]\s*([^\s,;]+)/i.exec(text)
  if (match) {
    const val = match[1].replace(/^["'`]|["'`]$/g, "")
    if (!/^[A-Z][A-Z0-9_]{3,}$/.test(val) && val !== "[redacted]") return true
  }
  return false
}
