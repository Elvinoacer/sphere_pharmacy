import type { Metadata } from "next"
import Link from "next/link"
import { parseOpenApi } from "@/lib/docs/openapi"
import { ApiExplorer } from "@/components/docs/api-explorer"
import { DocBreadcrumb } from "@/components/docs/doc-furniture"

export const metadata: Metadata = {
  title: "API reference",
  description: "Every Sphere Pharmacy API endpoint — searchable and filterable, generated from the OpenAPI 3.1 contract.",
}

export default function ApiReferencePage() {
  const spec = parseOpenApi()

  return (
    <div className="mx-auto max-w-5xl">
      <DocBreadcrumb items={[{ title: "Docs", url: "/docs" }, { title: "API reference" }]} />
      <h1 className="text-3xl font-bold tracking-tight text-foreground">API reference</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {spec.endpoints.length} endpoints across {spec.pathCount} paths, generated directly from the
        machine-readable contract <span className="docs-repo-file">openapi/sphere-api.yaml</span> (OpenAPI {spec.version},
        {" "}{spec.schemaCount} schemas). The YAML file remains the source of truth — this page is a rendering of it.
        For conventions, error shapes and side effects, read the{" "}
        <Link href="/docs/api/api-reference" className="font-medium text-primary hover:underline">human-written API contract doc</Link>.
      </p>
      <dl className="mt-6 mb-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Endpoints</dt>
          <dd className="mt-0.5 text-lg font-bold text-foreground tabular-nums">{spec.endpoints.length}</dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Paths</dt>
          <dd className="mt-0.5 text-lg font-bold text-foreground tabular-nums">{spec.pathCount}</dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Schemas</dt>
          <dd className="mt-0.5 text-lg font-bold text-foreground tabular-nums">{spec.schemaCount}</dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Categories</dt>
          <dd className="mt-0.5 text-lg font-bold text-foreground tabular-nums">{spec.tags.length}</dd>
        </div>
      </dl>
      <ApiExplorer endpoints={spec.endpoints} tags={spec.tags} />
    </div>
  )
}
