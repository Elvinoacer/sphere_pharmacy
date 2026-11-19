import type { Metadata } from "next"
import { DocsAssistant } from "@/components/docs/docs-assistant"
import { DocBreadcrumb } from "@/components/docs/doc-furniture"
import { ShieldCheck } from "lucide-react"

export const metadata: Metadata = {
  title: "Ask Sphere Docs",
  description: "AI documentation assistant grounded in the Sphere Pharmacy documentation corpus, with citations to the exact sections.",
}

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function AssistantPage({ searchParams }: Props) {
  const { page } = await searchParams

  return (
    <div className="mx-auto max-w-3xl">
      <DocBreadcrumb items={[{ title: "Docs", url: "/docs" }, { title: "Ask Sphere Docs" }]} />
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Ask Sphere Docs</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        An assistant grounded in the canonical documentation corpus. It cites the exact document and section for
        every answer and distinguishes implemented from environment-dependent behaviour. When no AI provider key
        is configured it still answers from lexical retrieval — the same deterministic-first pattern as the
        storefront assistant.
      </p>

      <div className="mt-6">
        <DocsAssistant pageContext={page} />
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          <span className="font-semibold text-foreground">Security boundary:</span> this assistant retrieves
          reference documentation only. It never receives customer records, prescription contents, staff
          information or any account-scoped data — consistent with the platform&apos;s{" "}
          <a href="/docs/security/ai-access-and-authorized-sessions" className="text-primary underline underline-offset-2">
            AI access and authorized sessions policy
          </a>
          . Configuration: <span className="docs-repo-file">GROQ_API_KEY</span> and{" "}
          <span className="docs-repo-file">GROQ_MODEL</span> enable synthesized answers (see{" "}
          <a href="/docs/integrations/ai-provider" className="text-primary underline underline-offset-2">AI provider integration</a>).
        </p>
      </div>
    </div>
  )
}
