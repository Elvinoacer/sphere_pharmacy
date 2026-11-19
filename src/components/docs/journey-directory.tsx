"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowRight, Route, Search } from "lucide-react"

export interface JourneyListItem {
  id: string
  title: string
  actor: string
  area: string
  status: string
  url: string
  description: string
  related: number
}

export interface RoleListItem {
  title: string
  url: string
  description: string
}

const ACTORS = ["Customer", "Pharmacist", "Staff", "Admin", "Rider", "System"]

const ACTOR_DESCRIPTIONS: Record<string, string> = {
  Customer: "Guests and signed-in customers — browsing, checkout, prescriptions, services, loyalty and account",
  Pharmacist: "Prescription review and the clinical workspace boundaries",
  Staff: "Order processing, catalogue, stock, medicine requests, services and appointments",
  Admin: "Dispatch, staff management, promotions, reports, settings and compliance",
  Rider: "Assigned deliveries and cash-on-delivery confirmation",
  System: "Provider webhooks, scheduled jobs, integrations and pipelines",
}

export function JourneyDirectory({
  journeys,
  roles,
  initialActor,
}: {
  journeys: JourneyListItem[]
  roles: RoleListItem[]
  initialActor?: string
}) {
  const [query, setQuery] = useState("")
  const [actor, setActor] = useState(initialActor && ACTORS.includes(initialActor) ? initialActor : "")
  const [area, setArea] = useState("")
  const [status, setStatus] = useState("")

  const areas = useMemo(() => [...new Set(journeys.map((j) => j.area))].sort(), [journeys])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return journeys.filter((journey) => {
      if (actor && journey.actor !== actor) return false
      if (area && journey.area !== area) return false
      if (status && journey.status !== status) return false
      if (!needle) return true
      return (
        journey.title.toLowerCase().includes(needle) ||
        journey.id.toLowerCase().includes(needle) ||
        journey.description.toLowerCase().includes(needle) ||
        journey.area.toLowerCase().includes(needle)
      )
    })
  }, [journeys, query, actor, area, status])

  const grouped = useMemo(() => {
    const groups = new Map<string, JourneyListItem[]>()
    for (const journey of filtered) {
      const list = groups.get(journey.actor) ?? []
      list.push(journey)
      groups.set(journey.actor, list)
    }
    return ACTORS.filter((a) => groups.has(a)).map((a) => [a, groups.get(a)!] as const)
  }, [filtered])

  return (
    <div>
      {/* Filters */}
      <div className="sticky top-14 z-20 -mx-4 mb-8 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6" role="search">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search journeys — try “prescription”, “M-Pesa”, “dispatch”…"
              aria-label="Search journeys"
              className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          <label className="sr-only" htmlFor="journey-area">Filter by functional area</label>
          <select
            id="journey-area"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">All areas</option>
            {areas.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="journey-status">Filter by implementation status</label>
          <select
            id="journey-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">Any status</option>
            <option value="implemented">Implemented</option>
            <option value="environment-dependent">Environment-dependent</option>
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by actor">
          <button
            type="button"
            onClick={() => setActor("")}
            aria-pressed={!actor}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              !actor ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            All actors
          </button>
          {ACTORS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setActor(actor === item ? "" : item)}
              aria-pressed={actor === item}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                actor === item ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {item}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
            {filtered.length} of {journeys.length} journeys
          </span>
        </div>
      </div>

      {/* Role maps */}
      {grouped.length === 0 && !query && !actor && !area && !status ? null : (
        <section aria-label="Role overviews" className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Start with a role map</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((role) => (
              <Link
                key={role.url}
                href={role.url}
                className="group rounded-lg border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground group-hover:text-primary">
                  <Route className="h-4 w-4 text-primary" aria-hidden />
                  {role.title}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{role.description}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Journeys */}
      {grouped.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" role="status">
          No journeys match the current filters.
        </p>
      ) : (
        grouped.map(([groupActor, items]) => (
          <section key={groupActor} aria-labelledby={`actor-${groupActor}`} className="mb-10">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`actor-${groupActor}`} className="text-lg font-semibold text-foreground">
                {groupActor} <span className="text-sm font-normal text-muted-foreground">· {items.length}</span>
              </h2>
              <p className="text-xs text-muted-foreground">{ACTOR_DESCRIPTIONS[groupActor]}</p>
            </div>
            <ul className="grid gap-2.5 md:grid-cols-2">
              {items.map((journey) => (
                <li key={journey.url}>
                  <Link
                    href={journey.url}
                    className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-ring hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex items-center gap-2">
                      <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[0.6875rem] font-bold text-primary">{journey.id}</span>
                      <span className="docs-status text-[0.6875rem]" data-status={journey.status} aria-label={`Status: ${journey.status}`}>
                        <span className="sr-only">{journey.status}</span>
                      </span>
                      <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[0.625rem] text-muted-foreground">{journey.area}</span>
                    </span>
                    <span className="mt-2 text-sm font-semibold text-foreground group-hover:text-primary">{journey.title}</span>
                    <span className="mt-1 line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">{journey.description}</span>
                    <span className="mt-2.5 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-primary">
                      View flowchart <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
