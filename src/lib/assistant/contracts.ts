import { z } from "zod";

export const assistantViews = [
  "home",
  "catalog",
  "services",
  "cart",
  "checkout",
  "orders",
  "prescriptions",
  "account",
  "auth",
] as const;
export const intentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), view: z.enum(assistantViews) }),
  z.object({
    type: z.literal("search"),
    query: z.string().trim().min(1).max(100),
  }),
  z.object({ type: z.literal("book"), query: z.string().trim().max(100) }),
  z.object({ type: z.literal("pay") }),
  z.object({ type: z.literal("appointments") }),
  z.object({ type: z.literal("none") }),
]);
export type AssistantIntent = z.infer<typeof intentSchema>;
export type AssistantAction =
  | { type: "navigate"; view: (typeof assistantViews)[number]; label: string }
  | { type: "search"; query: string; label: string }
  | {
      type: "product";
      id: string;
      label: string;
      price: number;
      packSize: string | null;
      stockStatus: string;
      requiresPrescription: boolean;
    }
  | {
      type: "book";
      id: string;
      label: string;
      price: number | null;
      duration: number;
    }
  | { type: "pay"; label: string }
  | { type: "appointments"; label: string };

// Product strength (e.g. 500mg) is a valid search. Suitability and dosage are not.
export function safetyResponse(text: string): string | null {
  if (
    /\b(overdos(?:e|ed|ing)|can'?t breathe|cannot breathe|difficulty breathing|severe chest pain|unconscious|kill myself|end my life)\b/i.test(
      text,
    )
  )
    return "I’m sorry you’re going through this. This may need urgent help. Please contact local emergency services or go to the nearest emergency department now. If possible, ask someone nearby to stay with you. Please don’t wait for a chat reply.";
  if (
    /\b(dose|dosage|side[- ]effects?|interactions?|contraindications?|diagnos\w*)\b|\b(what|which|recommend)\b.*\b(medicine|drug|treatment)\b.*\b(for|should)\b|\b(how (much|many|often)|can i|should i|may i)\b.*\b(take|use|mix|combine|give)\b|\b(pregnant|breastfeeding|breast-feeding)\b.*\b(take|medicine|drug|safe)\b|\b(treat|cure)\b.*\b(my|infection|symptom)\b/i.test(
      text,
    )
  )
    return "I’m glad you asked before deciding. Your circumstances matter, and I don’t want to guess about a medicine or dose. Our pharmacy team can help you work through this safely—use the contact options below. I can still help you find a product or arrange a medication review.";
  return null;
}
export function hasCredential(text: string): boolean {
  if (/\b(?:pin|otp|one[- ]time code)\s+(?:is\s+)?\d{3,8}\b/i.test(text)) return true;
  return /\b(?:gsk_|sk-)[A-Za-z0-9_-]{12,}|\b(?:password|api[_ -]?key|secret|token|pin|otp)\s*(?:[:=]|\bis\b)\s*\S+/i.test(
    text,
  );
}
export function redact(text: string): string {
  return text
    .slice(0, 1800)
    .replace(/\b(?:gsk_|sk-)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(
      /\b(password|api[_ -]?key|secret|token|pin|otp)\s*(?:[:=]|\bis\b)\s*\S+/gi,
      "$1: [redacted]",
    )
    .replace(/\b(?:\+?254|0)[17]\d{8}\b/g, "[phone redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]");
}
export function fallbackIntent(text: string): AssistantIntent {
  const t = text.toLowerCase().trim();
  if (
    /\b(pay|payment|mpesa|m-pesa)\b/.test(t) &&
    !/\b(methods?|accept|how (?:does|do|can)|what (?:is|are)|ways to|options?)\b/.test(t)
  )
    return { type: "pay" };
  if (/\b(check\s?out)\b/.test(t))
    return { type: "navigate", view: "checkout" };
  if (/\b(my|view|track)\b.*\b(appointments|bookings)\b/.test(t))
    return { type: "appointments" };
  if (/\b(book|schedule|appointment)\b/.test(t))
    return {
      type: "book",
      query: t
        .replace(
          /\b(i|would|like|to|a|an|please|book|schedule|appointment|for|me)\b/g,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim(),
    };
  if (
    /\b(opening hours?|closing hours?|working hours?|operating hours?|what time do you (?:open|close)|when are you open|are you open(?: now| today)?|where are you|your location|your address|directions|contact (?:details|info|us)|phone number|whatsapp number|email address)\b/.test(
      t,
    )
  )
    return { type: "none" };
  if (/\b(delivery|deliver|shipping|delivery zones?|free delivery)\b/.test(t))
    return { type: "navigate", view: "checkout" };
  const views: [RegExp, (typeof assistantViews)[number]][] = [
    [/\b(cart|bag|basket)\b/, "cart"],
    [/\b(orders?|track delivery|guest tracking)\b/, "orders"],
    [/\b(prescriptions?|refill|upload)\b/, "prescriptions"],
    [/\b(account|profile|address|preferences|points|loyalty)\b/, "account"],
    [/\b(services|clinic)\b/, "services"],
    [/\b(catalogue|catalog|browse products|current offers|offers)\b/, "catalog"],
    [/\b(home|landing)\b/, "home"],
    [/\b(sign in|login)\b/, "auth"],
  ];
  for (const [pattern, view] of views)
    if (pattern.test(t)) return { type: "navigate", view };
  if (
    /\b(find|search|show|open|buy|add|stock|have|price|cost|looking for)\b/.test(
      t,
    )
  ) {
    const query = t
      .replace(/\b(how much|looking for|in stock|do you|can you|can i)\b/g, " ")
      .replace(
        /\b(i|a|an|the|some|please|me|to|my|want|need|find|search|for|show|open|buy|add|stock|have|is|price|cost|of|get)\b/g,
        " ",
      )
      .replace(/[?!.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    if (query) return { type: "search", query };
  }
  return { type: "none" };
}

export function fallbackReply(text: string): string {
  if (/\b(hours|opening|closing|open now)\b/i.test(text))
    return "You’re welcome to visit us daily, 8:00 AM–10:30 PM, on Lumumba Drive, Roysambu. Holiday hours can vary—call +254 707 475 208 if you’d like to check before coming.";
  if (/\b(where|location|address|directions)\b/i.test(text))
    return "You’ll find Sphere Pharmacy on Lumumba Drive, Roysambu, Nairobi. Call +254 707 475 208 if you need a hand finding us.";
  if (/\b(deliver|delivery|pickup)\b/i.test(text))
    return "You can choose delivery or pickup at checkout. Your delivery options and exact fee are shown after you enter your location. I can take you to checkout whenever you’re ready.";
  return "I’m here to help. Tell me the product you’re looking for, the service you’d like to book, or which part of your account you want to open.";
}
export function safeModelReply(text: string): string {
  if (
    hasCredential(text) ||
    /\b(i(?:’|')?ve|i have|successfully|already)\b.{0,35}\b(paid|booked|charged|ordered|submitted|added)\b/i.test(
      text,
    )
  )
    return "I can help you prepare the next step. Please use the action cards to review and confirm any changes.";
  return text.slice(0, 2000);
}
