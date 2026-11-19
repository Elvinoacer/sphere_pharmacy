import type { Metadata } from "next"
import Link from "next/link"
import { Lock, Store, ShieldCheck } from "lucide-react"
import { DocsShell } from "@/components/docs/docs-shell"
import { getNavigation } from "@/lib/docs/navigation"
import { getSession, type ResolvedSession } from "@/lib/session"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AdminAccessFrame } from "@/components/views/admin/admin-access"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: {
    default: "Sphere Pharmacy Documentation",
    template: "%s — Sphere Pharmacy Documentation",
  },
  description:
    "Internal documentation for Sphere Pharmacy staff and administrators: operational journeys, architecture, features, API reference, database explorer, security and operations.",
  robots: { index: false, follow: false },
}

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  let session: ResolvedSession | null = null
  try {
    session = await getSession()
  } catch {
    session = null
  }

  if (!session || !session.staffId) {
    const isCustomer = session?.role === "CUSTOMER"
    return (
      <AdminAccessFrame>
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Lock className="h-7 w-7" aria-hidden />
            </span>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Staff documentation access</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {isCustomer
                  ? "You're signed in with a customer account. The documentation portal is restricted to Sphere Pharmacy staff and administrators."
                  : "Sign in with your Sphere Pharmacy staff or administrator account to access internal operational guides, architecture docs and the documentation AI assistant."}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button asChild className="h-11 w-full">
                <Link href="/auth?mode=staff&next=admin">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Sign in as staff
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 w-full">
                <Link href="/">
                  <Store className="h-4 w-4" aria-hidden /> Back to storefront
                </Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Need customer help? Use the storefront assistant for opening hours, location, delivery fees and store navigation.
            </p>
          </CardContent>
        </Card>
      </AdminAccessFrame>
    )
  }

  const groups = getNavigation()
  return <DocsShell groups={groups}>{children}</DocsShell>
}
