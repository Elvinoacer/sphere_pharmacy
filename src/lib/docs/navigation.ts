import "server-only"

import { getCorpus, type DocRecord } from "./content"

/**
 * Canonical navigation tree for the documentation portal.
 * URLs always point at real corpus documents (or portal hubs); counts and
 * entries are derived from the corpus so navigation can never drift from it.
 */

export interface NavChild {
  title: string
  url: string
  /** optional short label override */
  hint?: string
}

export interface NavGroup {
  id: string
  title: string
  description: string
  icon: string // lucide icon name, resolved by the client sidebar
  audience: Array<"operations" | "engineering" | "administration">
  children: NavChild[]
}

const GROUPS: Array<Omit<NavGroup, "children"> & { patterns: string[] }> = [
  {
    id: "start",
    title: "Start here",
    description: "What Sphere Pharmacy is and how to find your way around",
    icon: "Compass",
    audience: ["operations", "engineering", "administration"],
    patterns: [
      "readme",
      "product/product-overview",
      "product/feature-catalogue",
      "product/user-roles-and-permissions",
      "product/customer-journeys",
    ],
  },
  {
    id: "journeys",
    title: "User journeys",
    description: "Every operational flow, traced end to end with flowcharts",
    icon: "Route",
    audience: ["operations", "engineering", "administration"],
    patterns: ["__hub__:/docs/journeys"],
  },
  {
    id: "product",
    title: "Pharmacy operations",
    description: "Operating the platform day to day",
    icon: "Store",
    audience: ["operations"],
    patterns: ["product/pharmacy-operations"],
  },
  {
    id: "architecture",
    title: "Architecture",
    description: "How the system is built",
    icon: "Boxes",
    audience: ["engineering"],
    patterns: [
      "architecture/system-architecture",
      "architecture/frontend-architecture",
      "architecture/backend-architecture",
      "architecture/api-architecture",
      "architecture/authentication",
      "architecture/state-management",
    ],
  },
  {
    id: "features",
    title: "Features",
    description: "Subsystem deep-dives",
    icon: "Layers",
    audience: ["engineering"],
    patterns: [
      "features/storefront-and-catalogue",
      "features/inventory-and-stock",
      "features/prescriptions",
      "features/orders-and-fulfillment",
      "features/payments-and-refunds",
      "features/services-and-bookings",
      "features/loyalty-and-promotions",
      "features/notifications",
      "features/medicine-requests",
      "features/customer-crm",
      "features/ai-assistant",
    ],
  },
  {
    id: "database",
    title: "Database",
    description: "Schema, data dictionary, migrations",
    icon: "Database",
    audience: ["engineering"],
    patterns: [
      "__hub__:/docs/database",
      "database/schema-overview",
      "database/data-dictionary",
      "database/entity-relationship-diagram",
      "database/migrations",
      "database/data-lifecycle",
    ],
  },
  {
    id: "api",
    title: "API reference",
    description: "Every route handler and the OpenAPI contract",
    icon: "Braces",
    audience: ["engineering"],
    patterns: [
      "__hub__:/docs/api-reference",
      "api/api-reference",
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    description: "External providers and how they are wired in",
    icon: "Plug",
    audience: ["engineering"],
    patterns: [
      "integrations/mpesa-daraja",
      "integrations/intasend",
      "integrations/bandago-pos-crm",
      "integrations/cloudflare-r2",
      "integrations/firebase",
      "integrations/resend",
      "integrations/ai-provider",
    ],
  },
  {
    id: "security",
    title: "Security",
    description: "Access control, privacy, retention",
    icon: "ShieldCheck",
    audience: ["engineering", "administration"],
    patterns: [
      "security/security-architecture",
      "security/access-control",
      "security/ai-access-and-authorized-sessions",
      "security/file-storage-security",
      "security/privacy-and-health-data",
      "security/retention-and-deletion",
    ],
  },
  {
    id: "workflows",
    title: "Workflows",
    description: "Business process state machines",
    icon: "GitBranch",
    audience: ["engineering", "operations"],
    patterns: [
      "workflows/order-lifecycle",
      "workflows/prescription-lifecycle",
      "workflows/payment-lifecycle",
      "workflows/inventory-lifecycle",
      "workflows/service-bookings",
    ],
  },
  {
    id: "operations",
    title: "Operations",
    description: "Running, deploying and maintaining the platform",
    icon: "Server",
    audience: ["administration"],
    patterns: [
      "operations/local-development",
      "operations/environment-variables",
      "operations/deployment",
      "operations/database-operations",
      "operations/scheduled-jobs",
      "operations/backup-and-restore",
      "operations/troubleshooting",
    ],
  },
  {
    id: "governance",
    title: "Testing & governance",
    description: "Quality gates and decision records",
    icon: "ClipboardCheck",
    audience: ["engineering", "administration"],
    patterns: [
      "testing/testing-strategy",
      "governance/architecture-decisions",
      "governance/documentation-policy",
      "governance/technical-debt",
      "governance/release-history",
    ],
  },
  {
    id: "reference",
    title: "Reference",
    description: "Recording scripts, audits and project guides",
    icon: "BookOpen",
    audience: ["operations", "administration"],
    patterns: [
      "recording/platform-recording-script",
      "recording/recording-checklist",
      "recording/recording-journeys",
      "payment-notification-audit",
      "project/readme",
      "project/agents",
    ],
  },
]

let navCache: NavGroup[] | null = null

export function getNavigation(): NavGroup[] {
  if (navCache) return navCache
  const corpus = getCorpus()
  const groups: NavGroup[] = []
  for (const group of GROUPS) {
    const children: NavChild[] = []
    for (const pattern of group.patterns) {
      if (pattern.startsWith("__hub__:")) {
        const url = pattern.slice("__hub__:".length)
        let title = "Overview"
        if (url === "/docs/journeys") title = "Journey explorer"
        if (url === "/docs/database") title = "Database explorer"
        if (url === "/docs/api-reference") title = "API explorer"
        children.push({ title, url })
        if (url === "/docs/journeys") {
          for (const role of corpus.roleOverviews) {
            children.push({ title: role.title, url: role.url, hint: "Role map" })
          }
        }
        continue
      }
      const doc = corpus.byDocsPath.get(pattern)
      if (doc) children.push({ title: doc.title, url: doc.url })
    }
    if (children.length) {
      groups.push({
        id: group.id,
        title: group.title,
        description: group.description,
        icon: group.icon,
        audience: group.audience,
        children,
      })
    }
  }
  navCache = groups
  return groups
}

/** Flatten navigation into ordered leaf entries for prev/next links. */
export function getFlatNav(): Array<{ title: string; url: string }> {
  return getNavigation().flatMap((g) => g.children)
}

export function getNeighbors(url: string): { prev: { title: string; url: string } | null; next: { title: string; url: string } | null } {
  const flat = getFlatNav()
  const index = flat.findIndex((item) => item.url === url)
  if (index === -1) return { prev: null, next: null }
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index < flat.length - 1 ? flat[index + 1] : null,
  }
}

/** Journey ordering for prev/next within the journey collection. */
const JOURNEY_ACTOR_ORDER = ["Customer", "Pharmacist", "Staff", "Admin", "Rider", "System"]

export function getJourneyNeighbors(doc: DocRecord): { prev: DocRecord | null; next: DocRecord | null } {
  const corpus = getCorpus()
  const ordered = [...corpus.roleOverviews.filter((d) => d.docsPath !== "journeys/README"), ...corpus.journeys].sort(
    (a, b) => {
      const actorA = a.journey ? JOURNEY_ACTOR_ORDER.indexOf(a.journey.actor) : -1
      const actorB = b.journey ? JOURNEY_ACTOR_ORDER.indexOf(b.journey.actor) : -1
      if (actorA !== actorB) return actorA - actorB
      return a.docsPath.localeCompare(b.docsPath)
    },
  )
  const index = ordered.findIndex((d) => d.url === doc.url)
  if (index === -1) return { prev: null, next: null }
  return {
    prev: index > 0 ? ordered[index - 1] : null,
    next: index < ordered.length - 1 ? ordered[index + 1] : null,
  }
}
