import type { Metadata } from "next"
import Link from "next/link"
import { erDiagramFor, groupByDomain, parsePrismaSchema } from "@/lib/docs/prisma-schema"
import { DbExplorer } from "@/components/docs/db-explorer"
import { MermaidDiagram } from "@/components/docs/mermaid-diagram"
import { DocBreadcrumb } from "@/components/docs/doc-furniture"

export const metadata: Metadata = {
  title: "Database explorer",
  description: "Every Prisma model with fields, relations and indexes, plus per-domain entity-relationship diagrams generated from the schema.",
}

export default function DatabasePage() {
  const schema = parsePrismaSchema()
  const domains = groupByDomain(schema.models)
  const relationCount = schema.models.reduce(
    (sum, model) => sum + model.fields.filter((field) => field.relatedModel).length,
    0,
  )

  return (
    <div className="mx-auto max-w-5xl">
      <DocBreadcrumb items={[{ title: "Docs", url: "/docs" }, { title: "Database" }]} />
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Database explorer</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {schema.models.length} models and {schema.enums.length} enums, parsed live from{" "}
        <span className="docs-repo-file">prisma/schema.prisma</span> (provider: {schema.datasourceProvider}) —
        {" "}{relationCount} relation fields across {domains.length} domains. The entity-relationship diagrams below are
        generated from the schema itself, so they can never drift from it. For narrative context read the{" "}
        <Link href="/docs/database/schema-overview" className="font-medium text-primary hover:underline">schema overview</Link>,{" "}
        <Link href="/docs/database/data-dictionary" className="font-medium text-primary hover:underline">data dictionary</Link> and{" "}
        <Link href="/docs/database/entity-relationship-diagram" className="font-medium text-primary hover:underline">hand-authored ER walkthroughs</Link>.
      </p>

      <section aria-label="Domain relationship diagrams" className="mt-10 space-y-10">
        <h2 className="text-lg font-semibold text-foreground">Domain maps</h2>
        {domains.map((group) => (
          <div key={group.domain}>
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              {group.domain}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{group.models.map((m) => m.name).join(" · ")}</span>
            </h3>
            <MermaidDiagram code={erDiagramFor(group, schema.models)} title={`${group.domain} — entity relationships`} />
          </div>
        ))}
      </section>

      <section aria-label="Model explorer" className="mt-4">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Models</h2>
        <DbExplorer models={schema.models} enums={schema.enums} />
      </section>
    </div>
  )
}
