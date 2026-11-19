import type { Metadata } from "next"
import { getCorpus } from "@/lib/docs/content"
import { JourneyDirectory, type JourneyListItem, type RoleListItem } from "@/components/docs/journey-directory"
import { DocBreadcrumb } from "@/components/docs/doc-furniture"

export const metadata: Metadata = {
  title: "User journey explorer",
  description:
    "Every Sphere Pharmacy user journey — customer, pharmacist, staff, admin, rider and system — with interactive flowcharts, decision branches and implementation references.",
}

interface Props {
  searchParams: Promise<{ actor?: string }>
}

export default async function JourneysPage({ searchParams }: Props) {
  const { actor } = await searchParams
  const corpus = getCorpus()

  const journeys: JourneyListItem[] = corpus.journeys
    .map((doc) => ({
      id: doc.journey!.id,
      title: doc.title,
      actor: doc.journey!.actor,
      area: doc.journey!.area,
      status: doc.status,
      url: doc.url,
      description: doc.journey!.objective || doc.description,
      related: doc.journey!.relatedJourneys.length,
    }))
    .sort((a, b) => a.actor.localeCompare(b.actor) || a.id.localeCompare(b.id))

  const roles: RoleListItem[] = corpus.roleOverviews.map((doc) => ({
    title: doc.title,
    url: doc.url,
    description: doc.journey?.objective || doc.description,
  }))

  return (
    <div className="mx-auto max-w-5xl">
      <DocBreadcrumb items={[{ title: "Docs", url: "/docs" }, { title: "User journeys" }]} />
      <h1 className="text-3xl font-bold tracking-tight text-foreground">User journey explorer</h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Every operational flow supported by the platform, traced from its starting point to every outcome.
        Each journey has a flowchart with decision branches and failure paths, step-by-step explanations,
        and verified implementation references. Screenshots are deliberately deferred — scene IDs from the
        recording script are retained for future evidence.
      </p>
      <div className="mt-8">
        <JourneyDirectory journeys={journeys} roles={roles} initialActor={actor} />
      </div>
    </div>
  )
}
