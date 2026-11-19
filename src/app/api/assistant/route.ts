import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  enforceRateLimit,
  rejectOversizedRequest,
} from "@/lib/security/request";
import {
  assistantViews,
  fallbackIntent,
  safeModelReply,
  hasCredential,
  intentSchema,
  redact,
  safetyResponse,
  type AssistantAction,
  type AssistantIntent,
} from "@/lib/assistant/contracts";
import {
  buildPublicSystemPrompt,
  fallbackReplyWithSettings,
  loadPublicStoreSettings,
  matchCustomerSafeKnowledge,
} from "@/lib/assistant/public-knowledge";
const labels = {
  home: "Go home",
  catalog: "Explore the shop",
  services: "Explore care services",
  cart: "Review my bag",
  checkout: "Review checkout",
  orders: "View my orders",
  prescriptions: "Manage prescriptions",
  account: "Open My Sphere",
  auth: "Sign in",
};

async function resolveIntent(
  intent: AssistantIntent,
): Promise<{ reply?: string; actions: AssistantAction[] }> {
  if (intent.type === "navigate")
    return { actions: [{ ...intent, label: labels[intent.view] }] };
  if (intent.type === "pay")
    return {
      reply:
        "Let’s make that easier. Open your payment options below to select your own order or appointment, check the amount, and request an M-Pesa prompt. Nothing is charged from this conversation alone.",
      actions: [
        { type: "pay", label: "Review & pay with M-Pesa" },
        {
          type: "navigate",
          view: "checkout",
          label: "Checkout / card options",
        },
      ],
    };
  if (intent.type === "appointments")
    return { actions: [{ type: "appointments", label: "My appointments" }] };
  if (intent.type === "search") {
    const terms = intent.query.split(/\s+/).filter(Boolean).slice(0, 8);
    const products = await db.product.findMany({
      where: {
        active: true,
        AND: terms.map((term) => ({
          OR: [
            { name: { contains: term, mode: "insensitive" as const } },
            { brand: { contains: term, mode: "insensitive" as const } },
            { packSize: { contains: term, mode: "insensitive" as const } },
          ],
        })),
      },
      select: {
        id: true,
        name: true,
        price: true,
        packSize: true,
        stockStatus: true,
        requiresPrescription: true,
      },
      take: 4,
      orderBy: { name: "asc" },
    });
    return {
      reply: products.length
        ? "Here are the matching listings. Check the name, strength, and pack size before choosing. Availability will be checked again when you add an item."
        : "I couldn’t find an exact listing for that search. Try the product’s name or brand, or ask our pharmacy team to check it for you.",
      actions: [
        ...products.map((p) => ({
          type: "product" as const,
          id: p.id,
          label: p.name,
          price: Number(p.price),
          packSize: p.packSize,
          stockStatus: p.stockStatus,
          requiresPrescription: p.requiresPrescription,
        })),
        {
          type: "search",
          query: intent.query,
          label: "See all search results",
        },
      ],
    };
  }
  if (intent.type === "book") {
    const services = await db.service.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        price: true,
        durationMinutes: true,
        category: true,
      },
      take: 100,
      orderBy: { sortOrder: "asc" },
    });
    const terms = intent.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const ranked = services
      .map((s) => ({
        s,
        score: terms.filter((t) =>
          `${s.name} ${s.category}`.toLowerCase().includes(t),
        ).length,
      }))
      .sort((a, b) => b.score - a.score);
    const matches = terms.length ? ranked.filter((r) => r.score > 0) : ranked;
    return {
      reply: matches.length
        ? "Let’s find a time that works for you. Choose a service below, then a live slot. You’ll review the details before confirming your booking request."
        : "I couldn’t match that service by name. You can explore all published care services below, or tell me which check or consultation you’re looking for.",
      actions: [
        ...matches.slice(0, 3).map(({ s }) => ({
          type: "book" as const,
          id: s.id,
          label: s.name,
          price: s.price === null ? null : Number(s.price),
          duration: s.durationMinutes,
        })),
        { type: "navigate", view: "services", label: "All care services" },
      ],
    };
  }
  return { actions: [] };
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const answer = (
    reply: string,
    actions: AssistantAction[] = [],
    escalated = false,
  ) => NextResponse.json({ reply, actions, escalated }, { headers });
  try {
    const tooLarge = rejectOversizedRequest(request, 20_000);
    if (tooLarge) return tooLarge;
    const limited = await enforceRateLimit(
      request,
      "assistant",
      40,
      60 * 60_000,
    );
    if (limited) return limited;
    const body = await request.json();
    const incoming = Array.isArray(body?.messages) ? body.messages : [];
    const messages = incoming
      .filter(
        (m: { role?: unknown; content?: unknown }) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
      .slice(-8) as { role: "user" | "assistant"; content: string }[];
    const last = [...messages]
      .reverse()
      .find((m) => m.role === "user")
      ?.content.slice(0, 1800)
      .trim();
    if (!last)
      return answer(
        "Karibu! I can help you find a product, book a service, review checkout, or open your account. What would make today a little easier?",
      );
    if (hasCredential(last))
      return answer(
        "Please keep passwords, PINs, and one-time codes out of chat. I can open your account or payment options without needing those details.",
        [{ type: "navigate", view: "account", label: "Account help" }],
        true,
      );
    const safety = safetyResponse(last);
    if (safety) return answer(safety, [], true);

    const settings = await loadPublicStoreSettings();
    const knowledgeMatch = matchCustomerSafeKnowledge(last, settings);

    let intent = knowledgeMatch?.intent ?? fallbackIntent(last);
    let reply = knowledgeMatch?.reply ?? fallbackReplyWithSettings(last, settings);
    let hasModelReply = false;
    const apiKey = process.env.GROQ_API_KEY;
    const directRequest =
      /^(find|search|open|book|take me to|help me pay|show my|view my)\b/i.test(
        last,
      );
    if (apiKey && !knowledgeMatch && !(directRequest && intent.type !== "none")) {
      try {
        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
              messages: [
                { role: "system", content: buildPublicSystemPrompt(settings) },
                ...messages.map((m) => ({
                  role: m.role,
                  content: redact(m.content),
                })),
              ],
              temperature: 0.3,
              max_completion_tokens: 900,
              stream: false,
            }),
            signal: AbortSignal.timeout(12_000),
            cache: "no-store",
          },
        );
        if (response.ok) {
          const data = await response.json();
          const content = String(
            data?.choices?.[0]?.message?.content || "",
          ).replace(/^```(?:json)?\s*|\s*```$/g, "");
          const parsed = JSON.parse(content);
          const validated = intentSchema.safeParse(parsed.intent);
          if (validated.success) intent = validated.data;
          if (
            typeof parsed.reply === "string" &&
            parsed.reply.trim() &&
            !hasCredential(parsed.reply)
          ) {
            reply = safeModelReply(parsed.reply);
            hasModelReply = true;
          }
        }
      } catch {
        /* Deterministic actions remain available during provider outages. */
      }
    }

    if (knowledgeMatch) {
      if (
        /\b(worried|scared|anxious|frustrated|tired|unwell|sick|rough day)\b/i.test(
          last,
        ) &&
        !/sorry/i.test(reply)
      ) {
        reply = "I’m sorry this has been difficult. " + reply;
      }
      return answer(reply, knowledgeMatch.actions);
    }

    const resolved = await resolveIntent(intent);
    if (resolved.reply) {
      const acknowledgement =
        /\b(worried|scared|anxious|frustrated|tired|unwell|sick|rough day)\b/i.test(
          last,
        )
          ? "I’m sorry this has been difficult. "
          : "";
      reply = acknowledgement + resolved.reply;
    } else if (intent.type !== "none" && !hasModelReply)
      reply =
        "Of course—use the button below and I’ll help you get to the right place.";
    if (/\b(worried|scared|anxious|frustrated|tired|unwell|sick|rough day)\b/i.test(last) && !/sorry/i.test(reply)) reply = "I’m sorry this has been difficult. " + reply;
    return answer(reply, resolved.actions);
  } catch {
    return answer(
      "I’m sorry, something didn’t load. You can still open the shop or care services below, or speak with our pharmacy team.",
      [
        { type: "navigate", view: "catalog", label: "Open the shop" },
        { type: "navigate", view: "services", label: "Care services" },
      ],
      true,
    );
  }
}
