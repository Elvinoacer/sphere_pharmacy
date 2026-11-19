import { db } from "@/lib/db";
import { DELIVERY_DEFAULTS, LOYALTY, PHARMACY } from "@/lib/constants";
import type { DeliverySettings, PharmacySettings } from "@/lib/types";
import type { AssistantAction, AssistantIntent, assistantViews } from "./contracts";

export interface PublicStoreSettings {
  pharmacy: PharmacySettings;
  delivery: DeliverySettings;
}

const DEFAULT_PUBLIC_SETTINGS: PublicStoreSettings = {
  pharmacy: {
    name: PHARMACY.name,
    tagline: PHARMACY.tagline,
    phone: PHARMACY.phoneDisplay || PHARMACY.phone,
    whatsapp: PHARMACY.whatsapp,
    email: PHARMACY.email,
    address: PHARMACY.address,
    hoursLabel: PHARMACY.hoursLabel,
    mapsUrl: PHARMACY.mapsUrl,
  },
  delivery: {
    mode: DELIVERY_DEFAULTS.mode,
    flatFee: DELIVERY_DEFAULTS.flatFee,
    freeOver: DELIVERY_DEFAULTS.freeOver,
    nightDelivery: DELIVERY_DEFAULTS.nightDelivery,
    zones: DELIVERY_DEFAULTS.zones.map((z) => ({ ...z })),
    pricingMode: "zone",
  },
};

/**
 * Loads live admin-configured public store settings (pharmacy profile + delivery rules).
 * Explicitly excludes compliance/internal settings and falls back safely to defaults
 * when the database is unavailable or mocked in unit tests.
 */
export async function loadPublicStoreSettings(): Promise<PublicStoreSettings> {
  try {
    const settingModel = (
      db as unknown as {
        setting?: {
          findMany?: (args: {
            where: { key: { in: string[] } };
          }) => Promise<Array<{ key: string; valueJson: string }>>;
        };
      }
    ).setting;

    if (!settingModel || typeof settingModel.findMany !== "function") {
      return DEFAULT_PUBLIC_SETTINGS;
    }

    const rows = await settingModel.findMany({
      where: { key: { in: ["pharmacy", "delivery"] } },
    });
    const map = new Map(rows.map((row) => [row.key, row.valueJson]));

    const parse = <T>(raw: string | undefined, fallback: T): T => {
      if (!raw) return fallback;
      try {
        return { ...fallback, ...JSON.parse(raw) };
      } catch {
        return fallback;
      }
    };

    return {
      pharmacy: parse(map.get("pharmacy"), DEFAULT_PUBLIC_SETTINGS.pharmacy),
      delivery: parse(map.get("delivery"), DEFAULT_PUBLIC_SETTINGS.delivery),
    };
  } catch {
    return DEFAULT_PUBLIC_SETTINGS;
  }
}

export function formatDeliverySummary(delivery: DeliverySettings): string {
  const parts: string[] = [
    "You can choose **rider delivery** or **free in-pharmacy pickup** at checkout.",
  ];

  if (delivery.mode === "flat") {
    parts.push(`Standard delivery is a flat fee of **KES ${delivery.flatFee.toLocaleString()}**.`);
  } else if (delivery.pricingMode === "distance" && delivery.distanceBands?.length) {
    const bands = delivery.distanceBands
      .slice(0, 4)
      .map(
        (band) =>
          `${band.label} (${band.maxKm ? `up to ${band.maxKm} km` : `${band.minKm}+ km`}): **KES ${band.fee.toLocaleString()}**`,
      )
      .join(", ");
    parts.push(`Delivery is calculated by distance: ${bands}.`);
  } else if (delivery.zones?.length) {
    const zoneList = delivery.zones
      .map((zone) => `${zone.name.trim()} (**KES ${zone.fee.toLocaleString()}**)`)
      .join("; ");
    parts.push(`Delivery zones & fees: ${zoneList}.`);
  }

  if (delivery.freeOver && delivery.freeOver > 0) {
    parts.push(`Orders of **KES ${delivery.freeOver.toLocaleString()} or more** qualify for **free delivery**.`);
  }

  if (delivery.nightDelivery) {
    parts.push("Late-evening/night delivery is available.");
  }

  return parts.join(" ");
}

export function buildPublicSystemPrompt(settings: PublicStoreSettings): string {
  const { pharmacy, delivery } = settings;
  const deliverySummary = formatDeliverySummary(delivery);

  return `You are Sphere, the customer AI care companion for ${pharmacy.name} (${pharmacy.address}).
Live pharmacy settings (configured in real time by the pharmacy admin):
- Pharmacy name: ${pharmacy.name} (${pharmacy.tagline})
- Location / address: ${pharmacy.address}
- Opening hours: ${pharmacy.hoursLabel} (holiday hours may vary)
- Phone: ${pharmacy.phone} | WhatsApp: ${pharmacy.whatsapp} | Email: ${pharmacy.email}
- Delivery & pickup: ${deliverySummary}

Customer-safe storefront navigation & workflows you can explain:
- Catalogue ("catalog"): Browse OTC and prescription medicines, search by name/strength, filter by category/availability/Rx, or submit a "Can't find a medicine?" request.
- Care Services ("services"): Book clinical services (blood pressure, blood glucose, vaccinations, medication reviews) for in-pharmacy or home visit.
- Prescriptions ("prescriptions"): Upload JPG, PNG, WEBP, or PDF prescriptions (up to 6 MB) for pharmacist review before Rx dispensing, or request refills.
- Cart & Checkout ("cart", "checkout"): Choose delivery or pickup, apply promo codes or Sphere Points, and review totals.
- Payments ("pay"): M-Pesa STK Push, IntaSend card checkout, or Cash on pickup/delivery. Prescription orders await pharmacist approval before payment unlocks.
- Orders ("orders"): Track order status live. Guest orders can be tracked for 7 days on the same device or claimed via phone OTP.
- Account & Loyalty ("account", "auth"): Sign in with email/password or phone OTP. Earn 1 Sphere Point per KES ${LOYALTY.earnPerKES} spent; redeem from ${LOYALTY.minRedeem} points (1 point = KES ${LOYALTY.pointValue}, up to ${LOYALTY.maxRedeemPct}% of subtotal).

Strict security & clinical boundaries:
- Respond with one JSON object: {"reply":"warm, clear Markdown answer under 110 words","intent":{"type":"none"}}.
- Available intents: {"type":"search","query":"exact product name/strength"}, {"type":"book","query":"service name"}, {"type":"navigate","view":"home|catalog|services|cart|checkout|orders|prescriptions|account|auth"}, {"type":"pay"}, {"type":"appointments"}, {"type":"none"}.
- Never diagnose, prescribe, recommend a medicine for symptoms, validate suitability, or calculate doses; refer to the pharmacist.
- Never claim an order, booking, or payment has already been completed.
- Never discuss internal staff/admin tools, BandaGo POS sync, database schemas, internal API contracts, or staff documentation (/docs is restricted to staff).`;
}

const NAV_LABELS: Record<(typeof assistantViews)[number], string> = {
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

function navAction(view: (typeof assistantViews)[number]): AssistantAction {
  return { type: "navigate", view, label: NAV_LABELS[view] };
}

export interface CustomerKnowledgeMatch {
  reply: string;
  intent: AssistantIntent;
  actions: AssistantAction[];
}

/**
 * Matches customer-safe questions about live pharmacy settings (hours, location, contact,
 * delivery fees/zones), storefront page navigation, customer workflows from the docs,
 * and enforces the customer-only boundary when asked about internal/admin/staff docs.
 */
export function matchCustomerSafeKnowledge(
  text: string,
  settings: PublicStoreSettings,
): CustomerKnowledgeMatch | null {
  const t = text.toLowerCase().trim();
  const { pharmacy, delivery } = settings;

  // 1. Refuse internal / staff / admin / engineering documentation queries on the public assistant
  if (
    /\b(admin dashboard|staff dashboard|pos sync|bandago|prisma|database schema|openapi|webhook secret|cron job|staff login|internal docs?|engineering docs?|\/docs)\b/i.test(
      t,
    )
  ) {
    return {
      reply:
        "I’m Sphere’s **customer care companion**, so I only share public pharmacy information, store navigation, and shopping assistance. Internal operations and engineering documentation (`/docs`) is restricted to signed-in pharmacy staff.",
      intent: { type: "navigate", view: "catalog" },
      actions: [navAction("catalog"), navAction("services")],
    };
  }

  // 2. Real-time Opening Hours (from Admin Settings)
  if (
    /\b(opening hours?|closing hours?|working hours?|operating hours?|what time do you (?:open|close)|when are you open|are you open(?: now| today)?|hours of operation)\b/i.test(
      t,
    ) ||
    /^\s*(?:hours|opening|closing|open now)\s*[?!.]*\s*$/i.test(t)
  ) {
    return {
      reply: `**${pharmacy.name}** is open **${pharmacy.hoursLabel}** at **${pharmacy.address}**. Holiday hours may vary—feel free to call or WhatsApp us on **${pharmacy.phone}** if you’d like to confirm before visiting.`,
      intent: { type: "none" },
      actions: [navAction("catalog"), navAction("services")],
    };
  }

  // 3. Real-time Location, Address & Directions (from Admin Settings)
  if (
    /\b(where are you(?: located)?|your location|pharmacy location|your address|physical address|directions|how (?:do|can) i (?:get to|find) (?:you|the pharmacy)|where is sphere pharmacy)\b/i.test(
      t,
    ) ||
    /^\s*(?:where|location|address|directions)\s*[?!.]*\s*$/i.test(t)
  ) {
    return {
      reply: `You’ll find **${pharmacy.name}** at **${pharmacy.address}**. Hours: **${pharmacy.hoursLabel}**. Call or WhatsApp **${pharmacy.phone}** if you need directions or pickup assistance.`,
      intent: { type: "none" },
      actions: [navAction("catalog"), navAction("checkout")],
    };
  }

  // 4. Real-time Contact Details (Phone, WhatsApp, Email from Admin Settings)
  if (
    /\b(contact (?:details|info|number|us)|phone number|whatsapp number|email address|how (?:do|can) i (?:contact|call|reach|whatsapp) (?:you|the pharmacy|a pharmacist))\b/i.test(
      t,
    )
  ) {
    return {
      reply: `You can reach **${pharmacy.name}** directly during our opening hours (**${pharmacy.hoursLabel}**):\n- **Phone:** ${pharmacy.phone}\n- **WhatsApp:** ${pharmacy.whatsapp}\n- **Email:** ${pharmacy.email}\n- **Location:** ${pharmacy.address}`,
      intent: { type: "none" },
      actions: [navAction("services"), navAction("prescriptions")],
    };
  }

  // 5. Real-time Delivery Fees, Zones, Pickup & Free-Delivery Threshold (from Admin Settings)
  if (
    /\b(delivery|deliver|delivery fee|delivery cost|delivery price|shipping|delivery zones?|free delivery|pickup|pick up|night delivery)\b/i.test(
      t,
    )
  ) {
    return {
      reply: `${formatDeliverySummary(delivery)} You can select your preferred option and confirm the exact fee at **Checkout**.`,
      intent: { type: "navigate", view: "checkout" },
      actions: [navAction("checkout"), navAction("catalog")],
    };
  }

  // 6. Customer-safe Guide: Payment Methods (M-Pesa, Card, Cash)
  if (
    /\b(payment methods?|how (?:do|can) i pay|ways to pay|what payments? do you accept|do you accept (?:card|visa|mastercard|cash|mpesa|m-pesa)|pay on delivery|cash on delivery)\b/i.test(
      t,
    )
  ) {
    return {
      reply:
        "We support three payment methods at checkout:\n1. **M-Pesa STK Push** — instant prompt sent to your phone.\n2. **Card Checkout (IntaSend)** — pay securely with Visa or Mastercard.\n3. **Cash** — pay on in-pharmacy pickup or rider delivery.\n\n*Note:* Orders containing prescription-only (`Rx`) medicines unlock payment right after our pharmacist verifies your prescription.",
      intent: { type: "navigate", view: "checkout" },
      actions: [navAction("checkout"), { type: "pay", label: "Review & pay with M-Pesa" }],
    };
  }

  // 7. Customer-safe Guide: Prescriptions & Refills
  if (
    /\b(how (?:do|can|to) (?:i )?(?:upload|submit|send|refill) (?:a |my )?prescriptions?|prescription rules?|prescription verification|rx upload|refill (?:a |my )?prescription)\b/i.test(
      t,
    )
  ) {
    return {
      reply:
        "To upload or refill a prescription:\n1. Open **Prescriptions** and upload a clear photo or PDF (**JPG, PNG, WEBP, or PDF up to 6 MB**).\n2. Add any notes or link it to your checkout order.\n3. A licensed **pharmacist reviews and verifies** the prescription before prescription-only (`Rx`) medicines are priced for payment or dispensed.",
      intent: { type: "navigate", view: "prescriptions" },
      actions: [navAction("prescriptions"), navAction("catalog")],
    };
  }

  // 8. Customer-safe Guide: Sphere Points Loyalty & Promo Codes
  if (
    /\b(loyalty|sphere points|how (?:do|does) points work|earn points|redeem points|promo code|discount code|voucher)\b/i.test(
      t,
    )
  ) {
    return {
      reply: `**Sphere Points & Promo Codes:**\n- **Earn:** Registered customers earn **1 point per KES ${LOYALTY.earnPerKES}** spent on paid orders, plus **+50 welcome points** on registration.\n- **Redeem:** Redeem from **${LOYALTY.minRedeem} points** at checkout (**1 point = KES ${LOYALTY.pointValue}**, up to **${LOYALTY.maxRedeemPct}%** of your order subtotal).\n- **Promo codes:** Enter active promo codes at **Checkout** before paying.`,
      intent: { type: "navigate", view: "account" },
      actions: [navAction("account"), navAction("checkout")],
    };
  }

  // 9. Customer-safe Guide: Order Tracking & Guest Orders
  if (
    /\b(how (?:do|can|to) (?:i )?track (?:my |a |an )?(?:guest )?orders?|guest (?:checkout|orders?|tracking)|claim (?:my |a )?order|order status)\b/i.test(
      t,
    )
  ) {
    return {
      reply:
        "You can follow your order live in **Orders** (`Under Review` → `Awaiting Payment` → `Paid` → `Out for Delivery` / `Ready for Pickup`).\n- **Guest orders** stay trackable on the same browser for **7 days**.\n- You can also **claim guest orders** into your customer account anytime by verifying your phone number with a 6-digit OTP.",
      intent: { type: "navigate", view: "orders" },
      actions: [navAction("orders"), navAction("auth")],
    };
  }

  // 10. Customer-safe Guide: Medicine Requests ("Can't find a medicine?")
  if (
    /\b(can'?t find (?:a )?medicine|medicine request|request (?:a )?medicine|out of stock medicine|special order|not in catalogue|not listed)\b/i.test(
      t,
    )
  ) {
    return {
      reply:
        "If a medicine isn’t listed or is out of stock, open the **Catalogue** and use **Request a medicine**. Enter the medicine name, strength, quantity, and an optional photo—our pharmacy team will check availability and follow up with you.",
      intent: { type: "navigate", view: "catalog" },
      actions: [navAction("catalog"), navAction("prescriptions")],
    };
  }

  // 11. Customer-safe Guide: How to Navigate the Storefront / Available Pages
  if (
    /\b(navigate|navigation|where can i find|what pages|how to use (?:the )?(?:site|app|website|store)|site map|help me find my way|where do i go)\b/i.test(
      t,
    )
  ) {
    return {
      reply:
        "Here is how to navigate Sphere Pharmacy:\n- **Catalogue:** Search medicines, filter by category/Rx, or request an item.\n- **Care Services:** Book in-pharmacy or home clinical appointments.\n- **Prescriptions:** Upload an Rx image/PDF or request a refill.\n- **Cart & Checkout:** Choose delivery or pickup, apply points/promos, and pay.\n- **Orders & Account:** Track deliveries, view bookings, and manage Sphere Points.",
      intent: { type: "navigate", view: "catalog" },
      actions: [
        navAction("catalog"),
        navAction("services"),
        navAction("prescriptions"),
        navAction("orders"),
      ],
    };
  }

  return null;
}

export function fallbackReplyWithSettings(
  text: string,
  settings: PublicStoreSettings,
): string {
  const matched = matchCustomerSafeKnowledge(text, settings);
  if (matched) return matched.reply;
  const { pharmacy } = settings;
  return `I’m here to help with **${pharmacy.name}**. Ask me about our **opening hours (${pharmacy.hoursLabel})**, **location (${pharmacy.address})**, **delivery zones & fees**, **how to navigate the store**, or tell me a **product to search** or **care service to book**.`;
}
