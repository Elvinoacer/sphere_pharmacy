import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight, BookOpen, Boxes, Braces, ClipboardCheck, Database, GitBranch, Layers,
  MessageCircleQuestion, Plug, Route, Server, ShieldCheck, Store, Wrench, type LucideIcon,
} from "lucide-react"
import { getCorpus, getCorpusStats } from "@/lib/docs/content"
import { parseOpenApi } from "@/lib/docs/openapi"
import { parsePrismaSchema } from "@/lib/docs/prisma-schema"

export const metadata: Metadata = {
  title: "Sphere Pharmacy Documentation",
  description:
    "Pharmacy operations, engineering and system administration documentation with interactive user-journey flowcharts, API reference and database explorer.",
}

const CATEGORY_META: Record<string, { title: string; description: string; icon: LucideIcon; hub?: string }> = {
  product: { title: "Pharmacy operations", description: "What the platform does, feature catalogue, roles and the operator guide", icon: Store },
  architecture: { title: "Architecture", description: "System, frontend, backend, API, authentication and state management", icon: Boxes },
  features: { title: "Features", description: "Subsystem deep-dives: orders, prescriptions, payments, loyalty and more", icon: Layers },
  database: { title: "Database", description: "Schema overview, data dictionary, ER diagrams, migrations", icon: Database, hub: "/docs/database" },
  api: { title: "API reference", description: "All route handlers with the OpenAPI 3.1 contract", icon: Braces, hub: "/docs/api-reference" },
  integrations: { title: "Integrations", description: "M-Pesa Daraja, IntaSend, BandaGo POS/CRM, R2, Firebase, Resend, Groq", icon: Plug },
  security: { title: "Security", description: "Access control, AI access policy, privacy, retention", icon: ShieldCheck },
  workflows: { title: "Workflows", description: "Order, prescription, payment, inventory and booking state machines", icon: GitBranch },
  operations: { title: "Operations", description: "Deployment, environment variables, backups, scheduled jobs, troubleshooting", icon: Server },
  governance: { title: "Testing & governance", description: "Test strategy, architecture decisions, technical debt, releases", icon: ClipboardCheck },
  recording: { title: "Recording script", description: "The 51-scene functional acceptance matrix", icon: BookOpen },
}

const AUDIENCES: Array<{ id: string; title: string; description: string; href: string; icon: LucideIcon }> = [
  {
    id: "operations",
    title: "Pharmacy operations",
    description: "For owners, pharmacists, staff and riders — how the platform runs day to day: orders, prescriptions, inventory, dispatch and customer care.",
    href: "/docs/product/product-overview",
    icon: Store,
  },
  {
    id: "engineering",
    title: "Engineering",
    description: "For developers and AI coding agents — architecture, features, API, database, integrations, security and testing.",
    href: "/docs/architecture/system-architecture",
    icon: Boxes,
  },
  {
    id: "administration",
    title: "System administration",
    description: "For platform administrators — deployment, environment, database operations, backups, monitoring and governance.",
    href: "/docs/operations/deployment",
    icon: Server,
  },
]

const QUICK_ACCESS: Array<{ title: string; description: string; href: string }> = [
  { title: "Feature catalogue", description: "Every feature with implementation status", href: "/docs/product/feature-catalogue" },
  { title: "User roles", description: "The five roles and what each can do", href: "/docs/product/user-roles-and-permissions" },
  { title: "Customer journeys", description: "The six core operational journeys", href: "/docs/product/customer-journeys" },
  { title: "System architecture", description: "How the whole platform fits together", href: "/docs/architecture/system-architecture" },
  { title: "API reference", description: "Route handlers, searchable", href: "/docs/api-reference" },
  { title: "Database explorer", description: "Models with live ER diagrams", href: "/docs/database" },
  { title: "Integrations", description: "M-Pesa, IntaSend, BandaGo, R2, FCM", href: "/docs/integrations/bandago-pos-crm" },
  { title: "Deployment", description: "Standalone + Caddy pipeline", href: "/docs/operations/deployment" },
  { title: "Troubleshooting", description: "Symptom → cause → fix by area", href: "/docs/operations/troubleshooting" },
  { title: "Ask Sphere Docs", description: "AI assistant grounded in this corpus", href: "/docs/assistant" },
]

export default function DocsHomePage() {
  const api = parseOpenApi()
  const schema = parsePrismaSchema()
  const corpus = getCorpus()
  const stats = getCorpusStats(api.endpoints.length, schema.models.length)

  const verifiedLatest = [...stats.verifiedDates].sort().pop()
  const envDependent = corpus.journeys.filter((doc) => doc.status === "environment-dependent").length

  const firstDocInCategory = (categoryId: string): string => {
    const doc = corpus.docs.find((d) => d.category === categoryId)
    return doc ? doc.docsPath.replace(/^([^/]+)\//, "") : ""
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero */}
      <section className="pb-10 pt-4 sm:pt-8" aria-labelledby="docs-hero-title">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          {stats.totalDocs} documents · {stats.mermaidDiagrams} diagrams · verified {verifiedLatest ?? "recently"}
        </p>
        <h1 id="docs-hero-title" className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Sphere Pharmacy <span className="text-primary">Documentation</span>
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          The complete guide to the pharmacy operations platform — every user journey traced with interactive
          flowcharts, every API endpoint, every database model, and the operational runbooks that keep it running.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/docs/journeys"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Route className="h-4 w-4" aria-hidden />
            Explore user journeys
          </Link>
          <Link
            href="/docs/assistant"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-6 text-sm font-semibold text-foreground transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
          >
            <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden />
            Ask Sphere Docs
          </Link>
          <span className="text-xs text-muted-foreground">
            Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold">⌘K</kbd> to search everything
          </span>
        </div>
      </section>

      {/* Audiences */}
      <section aria-labelledby="audiences-title" className="border-t border-border py-10">
        <h2 id="audiences-title" className="text-lg font-semibold text-foreground">Choose your path</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((audience) => {
            const Icon = audience.icon
            return (
              <Link
                key={audience.id}
                href={audience.href}
                className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-ring hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-primary" aria-hidden>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-foreground">{audience.title}</span>
                <span className="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">{audience.description}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  Start here <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Journey explorer feature */}
      <section aria-labelledby="journeys-title" className="border-t border-border py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2 id="journeys-title" className="text-lg font-semibold text-foreground">
              The user journey explorer
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Every operational flow — customer, pharmacist, staff, admin, rider and system — documented as
              traceable Mermaid flowcharts with decision branches, error paths and implementation references.
              {stats.journeys > 0 ? (
                <>
                  {" "}{stats.journeys} journeys documented ({envDependent} environment-dependent — they need live
                  provider credentials to exercise end-to-end).
                </>
              ) : null}
            </p>
          </div>
          <Link href="/docs/journeys" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            Open the explorer <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {["Customer", "Pharmacist", "Staff", "Admin", "Rider", "System"].map((actor) => (
            <Link
              key={actor}
              href={`/docs/journeys?actor=${actor.toLowerCase()}`}
              className="rounded-lg border border-border bg-card p-4 text-center transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="block text-lg font-bold text-primary tabular-nums">{corpus.journeys.filter((doc) => doc.journey?.actor === actor).length}</span>
              <span className="block text-xs font-medium text-muted-foreground">{actor} journeys</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section aria-labelledby="categories-title" className="border-t border-border py-10">
        <h2 id="categories-title" className="text-lg font-semibold text-foreground">Explore the documentation</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.categories
            .filter((category) => CATEGORY_META[category.id])
            .map((category) => {
              const meta = CATEGORY_META[category.id]
              const Icon = meta.icon
              return (
                <Link
                  key={category.id}
                  href={meta.hub ?? `/docs/${category.id}/${firstDocInCategory(category.id)}`}
                  className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-ring hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary" aria-hidden>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {meta.title}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-semibold text-muted-foreground tabular-nums">
                        {category.count}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{meta.description}</span>
                  </span>
                </Link>
              )
            })}
        </div>
      </section>

      {/* Quick access */}
      <section aria-labelledby="quick-title" className="border-t border-border py-10">
        <h2 id="quick-title" className="text-lg font-semibold text-foreground">Quick access</h2>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {QUICK_ACCESS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-center justify-between gap-3 rounded-lg border border-transparent px-4 py-3 transition-colors hover:border-border hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground group-hover:text-primary">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Freshness */}
      <section aria-labelledby="freshness-title" className="border-t border-border py-10">
        <h2 id="freshness-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Wrench className="h-4 w-4 text-primary" aria-hidden />
          Documentation freshness
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">Documents in corpus</dt>
            <dd className="mt-1 text-xl font-bold text-foreground tabular-nums">{stats.totalDocs}</dd>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">Journey documents</dt>
            <dd className="mt-1 text-xl font-bold text-foreground tabular-nums">{stats.journeys}</dd>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">Diagrams (Mermaid)</dt>
            <dd className="mt-1 text-xl font-bold text-foreground tabular-nums">{stats.mermaidDiagrams}</dd>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">Most recent verification</dt>
            <dd className="mt-1 text-sm font-bold text-foreground">{verifiedLatest ?? "—"}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Counts derive from the actual corpus at build time. Every document carries an Audience / Status / Verified
          header stating when it was last checked against the code — nothing on this page is a fabricated date.
        </p>
      </section>
    </div>
  )
}
