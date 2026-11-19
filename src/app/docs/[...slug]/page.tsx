import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { getCorpus, type DocRecord } from "@/lib/docs/content"
import { getNeighbors } from "@/lib/docs/navigation"
import { Markdown } from "@/components/docs/markdown"
import { DocsToc } from "@/components/docs/docs-toc"
import { DocBreadcrumb, DocMeta, PrevNext } from "@/components/docs/doc-furniture"
import { MessageCircleQuestion } from "lucide-react"

interface Params {
  params: Promise<{ slug: string[] }>
}

function docForSlug(slug: string[]): DocRecord | null {
  const url = `/docs/${slug.join("/")}`
  const corpus = getCorpus()
  // Case-insensitive final segment match keeps hand-written links forgiving.
  const doc = corpus.byUrl.get(url)
  if (doc) return doc
  const lower = url.toLowerCase()
  for (const candidate of corpus.docs) {
    if (candidate.url.toLowerCase() === lower && !candidate.isJourney) return candidate
  }
  return null
}

export function generateStaticParams() {
  return getCorpus()
    .docs.filter((doc) => !doc.isJourney)
    .map((doc) => ({ slug: doc.url.replace("/docs/", "").split("/") }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const doc = docForSlug(slug)
  if (!doc) return {}
  return {
    title: doc.title,
    description: doc.description.slice(0, 200),
  }
}

export default async function DocPage({ params }: Params) {
  const { slug } = await params
  const doc = docForSlug(slug)
  if (!doc || doc.isJourney) notFound()

  const neighbors = getNeighbors(doc.url)
  const bodyWithoutH1 = doc.body.replace(/^#\s+.+\r?\n/, "")
  const categoryLabel = CATEGORY_LABELS[doc.category] ?? doc.category

  return (
    <article className="docs-with-toc">
      <div className="min-w-0">
        <DocBreadcrumb
          items={[
            { title: "Docs", url: "/docs" },
            ...(doc.category === "reference" || doc.category === "project" ? [] : [{ title: categoryLabel, url: `/docs?category=${doc.category}` }]),
            { title: doc.title },
          ]}
        />
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{doc.title}</h1>
        {doc.description && doc.description !== doc.title ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{doc.description}</p>
        ) : null}
        <DocMeta audience={doc.audience} status={doc.status} verified={doc.verified} />
        <Markdown doc={doc} body={bodyWithoutH1} />

        <div className="mt-10 rounded-xl border border-border bg-card p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <p className="text-sm text-muted-foreground">
            Have a question this page doesn&apos;t answer?
          </p>
          <Link
            href={`/docs/assistant?page=${encodeURIComponent(doc.title)}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline sm:mt-0"
          >
            <MessageCircleQuestion className="h-4 w-4" aria-hidden />
            Ask Sphere Docs about this page
          </Link>
        </div>

        <PrevNext prev={neighbors.prev} next={neighbors.next} />
      </div>
      <DocsToc headings={doc.headings} />
    </article>
  )
}

const CATEGORY_LABELS: Record<string, string> = {
  product: "Pharmacy operations",
  architecture: "Architecture",
  features: "Features",
  database: "Database",
  api: "API reference",
  integrations: "Integrations",
  security: "Security",
  workflows: "Workflows",
  operations: "Operations",
  testing: "Testing",
  governance: "Governance",
  recording: "Reference",
  reference: "Reference",
  project: "Project",
}
