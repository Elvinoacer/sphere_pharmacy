import Link from "next/link"
import { FileQuestion, Search } from "lucide-react"

export default function DocsNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-24 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden>
        <FileQuestion className="h-6 w-6" />
      </span>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Page not found</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        This documentation page doesn&apos;t exist. It may have been renamed — the canonical corpus lives in{" "}
        <span className="docs-repo-file">docs/</span> and only real documents are rendered here.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/docs"
          className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Documentation home
        </Link>
        <Link
          href="/docs/journeys"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Search className="h-4 w-4 text-primary" aria-hidden />
          Browse user journeys
        </Link>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Tip: press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold">⌘K</kbd> anywhere to search the corpus.
      </p>
    </div>
  )
}
