"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Search } from "lucide-react"

export interface EndpointListItem {
  method: string
  path: string
  summary: string
  tags: string[]
  auth: string
  anchor: string
  description: string
  rateLimit: string | null
  parameters: Array<{ name: string; in: string; required: boolean; description: string; schema: string }>
  requestBody: string | null
  responses: Array<{ status: string; description: string; schema: string }>
}

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"]

function methodTone(method: string): string {
  switch (method) {
    case "GET": return "text-emerald-700 dark:text-emerald-400"
    case "POST": return "text-teal-700 dark:text-teal-400"
    case "PATCH": return "text-amber-700 dark:text-amber-400"
    case "PUT": return "text-amber-700 dark:text-amber-400"
    case "DELETE": return "text-red-700 dark:text-red-400"
    default: return ""
  }
}

export function ApiExplorer({
  endpoints,
  tags,
}: {
  endpoints: EndpointListItem[]
  tags: Array<{ name: string; description: string }>
}) {
  const [query, setQuery] = useState("")
  const [method, setMethod] = useState("")
  const [tag, setTag] = useState("")
  const [auth, setAuth] = useState("")
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const authOptions = useMemo(
    () => [...new Set(endpoints.map((endpoint) => endpoint.auth))].sort(),
    [endpoints],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return endpoints.filter((endpoint) => {
      if (method && endpoint.method !== method) return false
      if (tag && !endpoint.tags.includes(tag)) return false
      if (auth && endpoint.auth !== auth) return false
      if (!needle) return true
      return (
        endpoint.path.toLowerCase().includes(needle) ||
        endpoint.summary.toLowerCase().includes(needle) ||
        endpoint.description.toLowerCase().includes(needle) ||
        endpoint.tags.some((t) => t.toLowerCase().includes(needle))
      )
    })
  }, [endpoints, query, method, tag, auth])

  const grouped = useMemo(() => {
    const groups = new Map<string, EndpointListItem[]>()
    for (const endpoint of filtered) {
      const key = endpoint.tags[0] ?? "Other"
      const list = groups.get(key) ?? []
      list.push(endpoint)
      groups.set(key, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div>
      <div className="sticky top-14 z-20 -mx-4 mb-8 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6" role="search">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search endpoints — path, summary, tag…"
              aria-label="Search API endpoints"
              className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          <label className="sr-only" htmlFor="api-tag">Filter by tag</label>
          <select
            id="api-tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">All categories</option>
            {tags.map((item) => (
              <option key={item.name} value={item.name}>{item.name}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="api-auth">Filter by authentication</label>
          <select
            id="api-auth"
            value={auth}
            onChange={(event) => setAuth(event.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">Any authentication</option>
            {authOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by HTTP method">
          <button
            type="button"
            onClick={() => setMethod("")}
            aria-pressed={!method}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${!method ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            All
          </button>
          {METHODS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMethod(method === item ? "" : item)}
              aria-pressed={method === item}
              className={`rounded-full border px-3 py-1 font-mono text-xs font-semibold transition-colors ${method === item ? "border-primary bg-primary text-primary-foreground" : `border-border ${methodTone(item)} hover:text-foreground`}`}
            >
              {item}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
            {filtered.length} of {endpoints.length} endpoints
          </span>
        </div>
      </div>

      {grouped.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" role="status">
          No endpoints match the current filters.
        </p>
      ) : (
        grouped.map(([groupName, items]) => {
          const tagMeta = tags.find((t) => t.name === groupName)
          return (
            <section key={groupName} aria-labelledby={`tag-${groupName}`} className="mb-10">
              <div className="mb-3">
                <h2 id={`tag-${groupName}`} className="text-lg font-semibold text-foreground">{groupName}</h2>
                {tagMeta?.description ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{tagMeta.description}</p> : null}
              </div>
              <ul className="space-y-2">
                {items.map((endpoint) => {
                  const expanded = open[endpoint.anchor] ?? false
                  return (
                    <li key={endpoint.anchor} id={endpoint.anchor} className="scroll-mt-32 overflow-hidden rounded-xl border border-border bg-card">
                      <button
                        type="button"
                        onClick={() => setOpen((prev) => ({ ...prev, [endpoint.anchor]: !expanded }))}
                        aria-expanded={expanded}
                        aria-controls={`${endpoint.anchor}-detail`}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span className="docs-method-badge shrink-0" data-method={endpoint.method}>{endpoint.method}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-sm font-semibold text-foreground">{endpoint.path}</span>
                          {endpoint.summary ? <span className="block truncate text-xs text-muted-foreground">{endpoint.summary}</span> : null}
                        </span>
                        <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.625rem] text-muted-foreground sm:inline">{endpoint.auth}</span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                      </button>
                      {expanded ? (
                        <div id={`${endpoint.anchor}-detail`} className="border-t border-border px-4 py-4 text-sm">
                          {endpoint.description ? (
                            <p className="mb-4 max-w-3xl leading-relaxed text-muted-foreground">{endpoint.description}</p>
                          ) : null}
                          <dl className="mb-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                            <div className="flex gap-2">
                              <dt className="font-semibold text-foreground">Authentication:</dt>
                              <dd className="text-muted-foreground">{endpoint.auth}</dd>
                            </div>
                            {endpoint.rateLimit ? (
                              <div className="flex gap-2">
                                <dt className="font-semibold text-foreground">Rate limit:</dt>
                                <dd className="text-muted-foreground">{endpoint.rateLimit}</dd>
                              </div>
                            ) : null}
                            <div className="flex gap-2">
                              <dt className="font-semibold text-foreground">Tags:</dt>
                              <dd className="text-muted-foreground">{endpoint.tags.join(", ")}</dd>
                            </div>
                          </dl>

                          {endpoint.parameters.length > 0 ? (
                            <section className="mb-4" aria-label="Parameters">
                              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parameters</h3>
                              <div className="docs-table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th scope="col">Name</th>
                                      <th scope="col">In</th>
                                      <th scope="col">Required</th>
                                      <th scope="col">Type</th>
                                      <th scope="col">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {endpoint.parameters.map((parameter) => (
                                      <tr key={`${parameter.in}-${parameter.name}`}>
                                        <td className="font-mono text-xs font-semibold text-foreground">{parameter.name}</td>
                                        <td>{parameter.in}</td>
                                        <td>{parameter.required ? "yes" : "no"}</td>
                                        <td className="font-mono text-xs text-muted-foreground">{parameter.schema}</td>
                                        <td className="text-muted-foreground">{parameter.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          ) : null}

                          {endpoint.requestBody ? (
                            <section className="mb-4" aria-label="Request body">
                              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Request body (application/json)</h3>
                              <pre className="docs-scrollbar overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">{endpoint.requestBody}</pre>
                            </section>
                          ) : null}

                          {endpoint.responses.length > 0 ? (
                            <section aria-label="Responses">
                              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responses</h3>
                              <ul className="space-y-1.5">
                                {endpoint.responses.map((response) => (
                                  <li key={response.status} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border/70 px-3 py-2">
                                    <span className={`font-mono text-xs font-bold ${response.status.startsWith("2") ? "text-emerald-700 dark:text-emerald-400" : response.status.startsWith("4") || response.status.startsWith("5") ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                                      {response.status}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{response.description}</span>
                                    {response.schema ? (
                                      <code className="w-full break-words font-mono text-[0.6875rem] text-muted-foreground">{response.schema}</code>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}
