"use client"

import { useMemo, useState } from "react"
import { ChevronDown, KeyRound, Link2, Search } from "lucide-react"

export interface FieldItem {
  name: string
  type: string
  relatedModel: string | null
  isList: boolean
  required: boolean
  isUnique: boolean
  isId: boolean
  default: string | null
  comment: string | null
}

export interface ModelItem {
  name: string
  tableName: string | null
  domain: string
  fields: FieldItem[]
  indexes: Array<{ kind: string; fields: string[]; name: string | null }>
  comment: string | null
}

function typeLabel(field: FieldItem): string {
  const base = field.relatedModel ? field.relatedModel : field.type
  return field.isList ? `${base}[]` : base
}

export function DbExplorer({ models, enums }: { models: ModelItem[]; enums: Array<{ name: string; values: string[] }> }) {
  const [query, setQuery] = useState("")
  const [domain, setDomain] = useState("")

  const domains = useMemo(() => [...new Set(models.map((m) => m.domain))].sort(), [models])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return models.filter((model) => {
      if (domain && model.domain !== domain) return false
      if (!needle) return true
      if (model.name.toLowerCase().includes(needle)) return true
      return model.fields.some((field) => field.name.toLowerCase().includes(needle) || field.type.toLowerCase().includes(needle))
    })
  }, [models, query, domain])

  const grouped = useMemo(() => {
    const groups = new Map<string, ModelItem[]>()
    for (const model of filtered) {
      const list = groups.get(model.domain) ?? []
      list.push(model)
      groups.set(model.domain, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const [open, setOpen] = useState<Record<string, boolean>>({})

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
              placeholder="Search models or fields — try “Order”, “loyaltyPoints”…"
              aria-label="Search database models"
              className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          <label className="sr-only" htmlFor="db-domain">Filter by domain</label>
          <select
            id="db-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="">All domains</option>
            {domains.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {filtered.length} of {models.length} models
          </span>
        </div>
      </div>

      {grouped.map(([groupDomain, items]) => (
        <section key={groupDomain} aria-labelledby={`domain-${groupDomain.replace(/\s+/g, "-")}`} className="mb-10">
          <h2 id={`domain-${groupDomain.replace(/\s+/g, "-")}`} className="mb-3 text-lg font-semibold text-foreground">
            {groupDomain} <span className="text-sm font-normal text-muted-foreground">· {items.length} models</span>
          </h2>
          <ul className="space-y-2">
            {items.map((model) => {
              const expanded = open[model.name] ?? false
              return (
                <li key={model.name} id={`model-${model.name}`} className="scroll-mt-32 overflow-hidden rounded-xl border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => setOpen((prev) => ({ ...prev, [model.name]: !expanded }))}
                    aria-expanded={expanded}
                    aria-controls={`model-${model.name}-detail`}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground">{model.name}</span>
                        {model.tableName && model.tableName !== model.name ? (
                          <span className="font-mono text-[0.6875rem] text-muted-foreground">→ {model.tableName}</span>
                        ) : null}
                      </span>
                      {model.comment ? <span className="block truncate text-xs text-muted-foreground">{model.comment}</span> : null}
                    </span>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.625rem] text-muted-foreground tabular-nums">
                      {model.fields.length} fields
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {expanded ? (
                    <div id={`model-${model.name}-detail`} className="border-t border-border px-4 py-4">
                      <div className="docs-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Field</th>
                              <th scope="col">Type</th>
                              <th scope="col">Attributes</th>
                              <th scope="col">Default</th>
                              <th scope="col">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {model.fields.map((field) => (
                              <tr key={field.name}>
                                <td className="font-mono text-xs font-semibold text-foreground">
                                  {field.name}
                                  {field.isId ? <KeyRound className="ml-1 inline h-3 w-3 text-primary" aria-label="primary key" /> : null}
                                </td>
                                <td className="font-mono text-xs">
                                  {field.relatedModel ? (
                                    <a href={`#model-${field.relatedModel}`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                                      <Link2 className="h-3 w-3" aria-hidden />
                                      {typeLabel(field)}
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">{typeLabel(field)}</span>
                                  )}
                                </td>
                                <td className="text-xs text-muted-foreground">
                                  {[field.required ? "required" : "optional", field.isUnique ? "unique" : "", field.isList ? "list" : ""].filter(Boolean).join(" · ")}
                                </td>
                                <td className="font-mono text-xs text-muted-foreground">{field.default ?? "—"}</td>
                                <td className="text-xs text-muted-foreground">{field.comment ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {model.indexes.length > 0 ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">Indexes:</span>{" "}
                          {model.indexes.map((index, i) => (
                            <span key={i}>
                              {i > 0 ? " · " : ""}
                              <span className={`font-mono ${index.kind === "unique" ? "font-semibold text-foreground" : ""}`}>
                                {index.kind === "unique" ? "@@unique" : "@@index"}({index.fields.join(", ")})
                              </span>
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <section aria-labelledby="enums-title" className="border-t border-border pt-8">
        <h2 id="enums-title" className="text-lg font-semibold text-foreground">Enums</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {enums.map((item) => (
            <div key={item.name} className="rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-sm font-semibold text-foreground">{item.name}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {item.values.map((value) => (
                  <li key={value} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">{value}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
