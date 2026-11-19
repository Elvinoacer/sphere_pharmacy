import Link from "next/link"
import { ArrowLeft, ArrowRight } from "lucide-react"
import type { DocStatus } from "@/lib/docs/frontmatter"

const STATUS_LABELS: Record<DocStatus, string> = {
  implemented: "Implemented",
  "environment-dependent": "Environment-dependent",
  planned: "Planned or not shipped",
  "needs-verification": "Requires live verification",
}

const AUDIENCE_LABELS: Record<string, string> = {
  operations: "Pharmacy operations",
  engineering: "Engineering",
  administration: "System administration",
}

export function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span className="docs-status" data-status={status} title={STATUS_LABELS[status]}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function DocBreadcrumb({ items }: { items: Array<{ title: string; url?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`} className="flex items-center gap-1.5">
            {item.url ? (
              <Link href={item.url} className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                {item.title}
              </Link>
            ) : (
              <span className="font-medium text-foreground" aria-current="page">{item.title}</span>
            )}
            {index < items.length - 1 ? <span aria-hidden>/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function DocMeta({
  audience,
  status,
  verified,
}: {
  audience: string[]
  status: DocStatus
  verified: string | null
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border py-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">Audience:</span>
        {audience.map((id) => AUDIENCE_LABELS[id] ?? id).join(" · ")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">Status:</span>
        <StatusBadge status={status} />
      </span>
      {verified ? (
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">Verified:</span>
          {verified}
        </span>
      ) : null}
    </div>
  )
}

export function PrevNext({
  prev,
  next,
}: {
  prev: { title: string; url: string } | null
  next: { title: string; url: string } | null
}) {
  return (
    <nav aria-label="Document navigation" className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
      {prev ? (
        <Link
          href={prev.url}
          className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground">Previous</span>
            <span className="block truncate text-sm font-medium text-foreground">{prev.title}</span>
          </span>
        </Link>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}
      {next ? (
        <Link
          href={next.url}
          className="group flex items-center justify-end gap-3 rounded-lg border border-border bg-card p-4 text-right transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="min-w-0">
            <span className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground">Next</span>
            <span className="block truncate text-sm font-medium text-foreground">{next.title}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ) : null}
    </nav>
  )
}
