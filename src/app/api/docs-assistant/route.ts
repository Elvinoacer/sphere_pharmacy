import { NextResponse } from "next/server"
import { enforceRateLimit, rejectOversizedRequest } from "@/lib/security/request"
import { ASSISTANT_SYSTEM_PROMPT, buildContext, retrieveSections, type RetrievedSection } from "@/lib/docs/assistant"

export const runtime = "nodejs"

/**
 * "Ask Sphere Docs" — documentation-grounded AI assistant.
 *
 * Retrieval: lexical, heading-aware, over the public documentation corpus only.
 * Provider: Groq (GROQ_API_KEY / GROQ_MODEL), same pattern as /api/assistant.
 * Without a key (or on provider failure) the route answers with the retrieved
 * sections themselves — a real, useful fallback rather than a canned reply.
 * The corpus is public reference data; no session is read, so the AI access
 * policy's authorized-session boundary is preserved by construction.
 */

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

interface Citation {
  n: number
  title: string
  heading: string
  url: string
  snippet: string
}

const MAX_QUESTION = 1200
const CONTEXT_MESSAGES = 6

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  try {
    const tooLarge = rejectOversizedRequest(request, 20_000)
    if (tooLarge) return tooLarge
    const limited = await enforceRateLimit(request, "docs-assistant", 20, 60 * 60_000).catch(() => null)
    if (limited) return limited

    const body = await request.json().catch(() => null)
    const incoming: ChatMessage[] = Array.isArray(body?.messages)
      ? body.messages
          .filter(
            (m: unknown) =>
              m && typeof m === "object" &&
              ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
              typeof (m as ChatMessage).content === "string",
          )
          .slice(-CONTEXT_MESSAGES)
      : []
    const questionRaw = [...incoming].reverse().find((m) => m.role === "user")?.content ?? ""
    const question = questionRaw.slice(0, MAX_QUESTION).trim()
    if (!question) {
      return NextResponse.json(
        { reply: "Ask me anything about Sphere Pharmacy — journeys, orders, prescriptions, payments, the API or the database.", citations: [], provider: "none" },
        { headers },
      )
    }

    // 1. Retrieve the most relevant documentation sections.
    const sections = retrieveSections(question, 6)
    const citations: Citation[] = sections.map((section, index) => ({
      n: index + 1,
      title: section.title,
      heading: section.heading,
      url: section.anchor ? `${section.url}#${section.anchor}` : section.url,
      snippet: section.snippet.slice(0, 320),
    }))

    if (!sections.length) {
      return NextResponse.json(
        {
          reply: `I couldn't find anything in the documentation corpus that matches “${question.slice(0, 120)}”. Try different terms — for example a feature name (prescriptions, loyalty, dispatch), an API path, or a model name. The search palette (⌘K) may also help.`,
          citations: [],
          provider: "lexical",
        },
        { headers },
      )
    }

    // 2. Try the LLM for a synthesized, cited answer.
    const apiKey = process.env.GROQ_API_KEY
    if (apiKey) {
      try {
        const context = buildContext(sections)
        const history = incoming
          .slice(0, -1)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }))
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
            messages: [
              { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
              ...history,
              {
                role: "user",
                content: `Question: ${question}\n\nRetrieved documentation excerpts:\n\n${context}`,
              },
            ],
            temperature: 0.3,
            max_completion_tokens: 700,
            stream: false,
          }),
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        })
        if (response.ok) {
          const data = await response.json()
          const reply = String(data?.choices?.[0]?.message?.content || "").trim()
          if (reply && reply.length > 10 && !hasCredential(reply)) {
            return NextResponse.json({ reply, citations, provider: "groq" }, { headers })
          }
        }
      } catch {
        /* fall through to lexical answer — the retrieval result is still valid */
      }
    }

    // 3. Deterministic lexical answer (no key / provider failure).
    const lines = sections.slice(0, 4).map((section, index) => {
      const where = section.heading && section.heading !== section.title ? ` — ${section.heading}` : ""
      return `${index + 1}. **${section.title}**${where}`;
    })
    const reply = apiKey
      ? `The AI provider didn't respond in time, so here are the most relevant sections from the documentation. You can also retry in a moment.\n\n${lines.join("\n")}\n\nOpen the sources below for the full text.`
      : `Here are the most relevant sections from the Sphere Pharmacy documentation${question ? ` for your question` : ""}:\n\n${lines.join("\n")}\n\nOpen the sources below for the full text.\n\n_Configuring \`GROQ_API_KEY\` enables synthesized, cited answers — without it, this assistant answers from lexical retrieval only (same pattern as the storefront assistant)._`
    return NextResponse.json({ reply, citations, provider: "lexical" }, { headers })
  } catch {
    return NextResponse.json(
      { error: "The documentation assistant could not process that request." },
      { status: 500, headers },
    )
  }
}

function hasCredential(text: string): boolean {
  return /\b(sk-[a-z0-9]{16,}|api[_-]?key\s*[:=]|bearer\s+[a-z0-9._-]{16,}|password\s*[:=]|pin\s*[:=])\b/i.test(text)
}
