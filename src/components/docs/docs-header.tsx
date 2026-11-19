"use client"

import Link from "next/link"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { LayoutDashboard, Menu, MessageCircleQuestion, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

export function DocsHeader({
  onOpenNav,
  onOpenSearch,
  sidebarCollapsed = false,
  onToggleSidebar,
}: {
  onOpenNav: () => void
  onOpenSearch: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-[92rem] items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenNav}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>

        {onToggleSidebar ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? "Expand documentation sidebar" : "Collapse documentation sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="docs-desktop-sidebar"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          </Button>
        ) : null}

        <Link href="/docs" className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-ring">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground" aria-hidden>
            S
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight text-foreground">Sphere Pharmacy</span>
            <span className="block text-[0.6875rem] leading-tight text-muted-foreground">Staff Documentation</span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenSearch}
            className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:flex"
            aria-label="Search documentation"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">Search documentation…</span>
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold text-muted-foreground md:inline" aria-hidden>
              ⌘K
            </kbd>
          </button>
          <Button variant="ghost" size="icon" onClick={onOpenSearch} className="sm:hidden" aria-label="Search documentation">
            <Search className="h-5 w-5" aria-hidden />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={mounted && resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {mounted && resolvedTheme === "dark" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
          </Button>

          <Button asChild variant="outline" size="sm" className="hidden gap-1.5 md:inline-flex">
            <Link href="/docs/assistant">
              <MessageCircleQuestion className="h-4 w-4" aria-hidden />
              Ask Sphere Docs
            </Link>
          </Button>

          <Button asChild variant="ghost" size="sm" className="hidden gap-1.5 text-muted-foreground hover:text-foreground lg:inline-flex">
            <Link href="/admin">
              <LayoutDashboard className="h-4 w-4" aria-hidden />
              Staff workspace
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
