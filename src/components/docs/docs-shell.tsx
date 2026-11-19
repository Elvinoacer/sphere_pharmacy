"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { Github } from "lucide-react"
import { DocsHeader } from "./docs-header"
import { DocsSidebar } from "./docs-sidebar"
import { SearchPalette } from "./search-palette"
import type { NavGroup } from "@/lib/docs/navigation"
import "./docs.css"

/**
 * Client shell for the documentation portal: header, palette, sidebar
 * (desktop) / drawer (mobile) and the sticky footer.
 */
export function DocsShell({
  groups,
  children,
}: {
  groups: NavGroup[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [navOpen, setNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen((prev) => !prev)
      } else if (event.key === "Escape") {
        setSearchOpen(false)
      } else if (event.key === "/" && !searchOpen) {
        const target = event.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) return
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [searchOpen])

  return (
    <div className="docs-shell bg-background">
      <DocsHeader onOpenNav={() => setNavOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Mobile navigation drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${navOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!navOpen}
      >
        <div
          className={`absolute inset-0 bg-foreground/25 transition-opacity ${navOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setNavOpen(false)}
        />
        <div
          className={`absolute inset-y-0 left-0 flex w-[85vw] max-w-xs flex-col bg-background shadow-xl transition-transform duration-200 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
          role="dialog"
          aria-modal="true"
          aria-label="Documentation navigation"
        >
          <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground" aria-hidden>S</span>
            <span className="text-sm font-semibold text-foreground">Documentation</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <DocsSidebar groups={groups} currentUrl={pathname} />
          </div>
        </div>
      </div>

      <div className="docs-body px-4 sm:px-6">
        <aside className="hidden lg:block" aria-label="Documentation navigation">
          <div className="docs-scrollarea">
            <DocsSidebar groups={groups} currentUrl={pathname} />
          </div>
        </aside>
        <div className="min-w-0 pb-16 pt-8">{children}</div>
      </div>

      <footer className="mt-auto border-t border-border bg-background">
        <div className="mx-auto flex max-w-90rem flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Sphere Pharmacy documentation — the canonical source lives in{" "}
            <span className="docs-repo-file">docs/</span>. When code and docs disagree, the code wins — then the docs get fixed.
          </p>
          <nav aria-label="Footer" className="flex items-center gap-4">
            <Link href="/docs" className="hover:text-foreground">Docs home</Link>
            <Link href="/docs/journeys" className="hover:text-foreground">Journeys</Link>
            <Link href="/docs/api-reference" className="hover:text-foreground">API</Link>
            <Link href="/docs/database" className="hover:text-foreground">Database</Link>
            <Link href="/" className="hover:text-foreground">Open app</Link>
            <span className="inline-flex items-center gap-1" aria-hidden>
              <Github className="h-3.5 w-3.5" />
            </span>
          </nav>
        </div>
      </footer>
    </div>
  )
}
