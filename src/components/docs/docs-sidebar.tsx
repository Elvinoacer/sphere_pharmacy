"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import {
  BookOpen, Boxes, Braces, ChevronDown, ClipboardCheck, Compass, Database, GitBranch, Layers,
  Plug, Route, Server, ShieldCheck, Store, type LucideIcon,
} from "lucide-react"
import type { NavGroup } from "@/lib/docs/navigation"
import "./docs.css"

const ICONS: Record<string, LucideIcon> = {
  Compass,
  Route,
  Store,
  Boxes,
  Layers,
  Database,
  Braces,
  Plug,
  ShieldCheck,
  GitBranch,
  Server,
  ClipboardCheck,
  BookOpen,
}

export function DocsSidebar({ groups, currentUrl }: { groups: NavGroup[]; currentUrl: string }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Auto-expand the group containing the active page, collapse the rest on first load.
  useEffect(() => {
    setCollapsed((prev) => {
      const next: Record<string, boolean> = {}
      for (const group of groups) {
        const active = group.children.some((child) => child.url === pathname)
        next[group.id] = prev[group.id] ?? !active
      }
      return next
    })
  }, [groups, pathname])

  return (
    <nav aria-label="Documentation" className="docs-scrollbar h-full overflow-y-auto py-6 pr-3">
      <ul className="space-y-1">
        {groups.map((group) => {
          const Icon = ICONS[group.icon] ?? BookOpen
          const groupActive = group.children.some((child) => child.url === pathname)
          const isCollapsed = collapsed[group.id] ?? !groupActive
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                aria-controls={`nav-group-${group.id}`}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${
                  groupActive ? "text-foreground" : "text-foreground/80"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="flex-1 truncate">{group.title}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  aria-hidden
                />
              </button>
              {!isCollapsed ? (
                <ul id={`nav-group-${group.id}`} className="mt-1 space-y-0.5 border-l border-border/70 ml-5">
                  {group.children.map((child) => (
                    <li key={child.url}>
                      <Link href={child.url} className="docs-nav-link" data-active={child.url === currentUrl}>
                        {child.title}
                        {child.hint ? <span className="sr-only"> ({child.hint})</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="mt-8 px-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
        Markdown in <span className="docs-repo-file">docs/</span> is the canonical source. This portal is a rendering layer over it.
      </p>
    </nav>
  )
}
