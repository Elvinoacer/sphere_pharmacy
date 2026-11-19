import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { getCorpus, type DocRecord } from "@/lib/docs/content"
import { getJourneyNeighbors } from "@/lib/docs/navigation"
import { Markdown } from "@/components/docs/markdown"
import { DocsToc } from "@/components/docs/docs-toc"
import { DocBreadcrumb, PrevNext, StatusBadge } from "@/components/docs/doc-furniture"
import { Camera, ListChecks } from "lucide-react"

interface Params {
  params: Promise<{ slug: string[] }>
}

const ACTOR_LABELS: Record<string, string> = {
  Customer: "Customer & guest",
  Pharmacist: "Pharmacist",
  Staff: "Pharmacy staff",
  Admin: "Administrator",
  Rider: "Rider",
  System: "System",
}

function docForSlug(slug: string[]): DocRecord | null {
  const url = `/docs/journeys/${slug.join("/")}`
  const corpus = getCorpus()
  const doc = corpus.byUrl.get(url)
  if (doc) return doc
  const lower = url.toLowerCase()
  for (const candidate of corpus.docs) {
    if (candidate.url.toLowerCase() === lower && candidate.isJourney) return candidate
  }
  return null
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const doc = docForSlug(slug)
  if (!doc) return {}
  const label = doc.journey && !doc.title.startsWith(doc.journey.id)
    ? `${doc.journey.id} · ${doc.title}`
    : doc.title
  return { title: label, description: doc.description.slice(0, 200) }
}

export default async function JourneyPage({ params }: Params) {
  const { slug } = await params
  const doc = docForSlug(slug)
  if (!doc || !doc.isJourney) notFound()

  const corpus = getCorpus()
  const journey = doc.journey
  const neighbors = getJourneyNeighbors(doc)
  const bodyWithoutH1 = doc.body.replace(/^#\s+.+\r?\n/, "")

  const relatedJourneys = (journey?.relatedJourneys ?? [])
    .map((id) => corpus.journeys.find((j) => j.journey?.id === id))
    .filter((j): j is DocRecord => Boolean(j))

  const actorSlug = journey?.actor.toLowerCase() ?? ""

  return (
    <article className="docs-with-toc">
      <div className="min-w-0">
        <DocBreadcrumb
          items={[
            { title: "Docs", url: "/docs" },
            { title: "User journeys", url: "/docs/journeys" },
            ...(journey ? [{ title: ACTOR_LABELS[journey.actor] ?? journey.actor, url: `/docs/journeys?actor=${actorSlug}` }] : []),
            { title: journey ? `${journey.id} · ${doc.title}` : doc.title },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          {journey ? (
            <span className="rounded-md bg-primary px-2 py-0.5 font-mono text-xs font-bold text-primary-foreground">{journey.id}</span>
          ) : null}
          <StatusBadge status={doc.status} />
          {journey ? <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">{journey.area}</span> : null}
          {doc.verified ? <span className="text-xs text-muted-foreground">Verified {doc.verified}</span> : null}
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">{doc.title}</h1>
        {doc.description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{doc.description}</p>
        ) : null}

        {journey ? <JourneyMetadata doc={doc} /> : null}

        <Markdown doc={doc} body={bodyWithoutH1} />

        {journey && journey.recordingRefs.length > 0 ? (
          <p className="mt-8 flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Evidence deferred by design: scene {journey.recordingRefs.join(", ")} of the recording script
              (docs/recording/platform-recording-script.md) maps to this journey; screenshots can be attached
              later without restructuring this document.
            </span>
          </p>
        ) : null}

        {relatedJourneys.length > 0 ? (
          <section aria-labelledby="related-journeys" className="mt-10 border-t border-border pt-6">
            <h2 id="related-journeys" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ListChecks className="h-4 w-4 text-primary" aria-hidden />
              Related journeys
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {relatedJourneys.map((related) => (
                <Link key={related.url} href={related.url} className="docs-chip">
                  <span className="font-mono font-bold text-primary">{related.journey!.id}</span>
                  {related.title}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <PrevNext
          prev={neighbors.prev ? { title: neighbors.prev.journey ? `${neighbors.prev.journey.id} · ${neighbors.prev.title}` : neighbors.prev.title, url: neighbors.prev.url } : null}
          next={neighbors.next ? { title: neighbors.next.journey ? `${neighbors.next.journey.id} · ${neighbors.next.title}` : neighbors.next.title, url: neighbors.next.url } : null}
        />
      </div>
      <DocsToc headings={doc.headings} />
    </article>
  )
}

function JourneyMetadata({ doc }: { doc: DocRecord }) {
  const journey = doc.journey!
  const isRole = doc.docsPath.startsWith("journeys/roles/")
  const rows: Array<[string, React.ReactNode]> = isRole
    ? [
        ["Actor", ACTOR_LABELS[journey.actor] ?? journey.actor],
        ["Area", journey.area],
        ["Status", <StatusBadge key="status" status={doc.status} />],
        ["Objective", journey.objective],
        ["Verified", journey.verified || "—"],
      ]
    : [
        ["Primary actor", ACTOR_LABELS[journey.actor] ?? journey.actor],
        ...(journey.secondaryActors.length
          ? ([
              ["Secondary actors", journey.secondaryActors.map((a) => ACTOR_LABELS[a] ?? a).join(", ")],
            ] as Array<[string, React.ReactNode]>)
          : []),
        ["Functional area", journey.area],
        ["Entry point", journey.entryPoint || "—"],
        ["Objective", journey.objective],
        ["Start condition", journey.startCondition],
        ["End condition", journey.endCondition],
      ]

  return (
    <section aria-label="Journey metadata" className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-border/60 last:border-b-0 align-top">
              <th scope="row" className="w-36 whitespace-nowrap bg-muted/40 px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                {label}
              </th>
              <td className="px-4 py-2.5 leading-relaxed text-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
