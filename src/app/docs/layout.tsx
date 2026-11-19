import type { Metadata } from "next"
import { DocsShell } from "@/components/docs/docs-shell"
import { getNavigation } from "@/lib/docs/navigation"

export const metadata: Metadata = {
  title: {
    default: "Sphere Pharmacy Documentation",
    template: "%s — Sphere Pharmacy Documentation",
  },
  description:
    "Complete documentation for the Sphere Pharmacy platform: user journeys with interactive flowcharts, architecture, features, API reference, database explorer, security and operations.",
  robots: { index: true, follow: true },
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const groups = getNavigation()
  return <DocsShell groups={groups}>{children}</DocsShell>
}
