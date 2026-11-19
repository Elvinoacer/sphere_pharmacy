"use client"

import { useEffect, useMemo, useState } from "react"
import type { DocHeading } from "@/lib/docs/utils"

/**
 * Right-hand table of contents with active-section tracking, a reading
 * progress indicator and a find-in-page heading filter.
 */
export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const [active, setActive] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [filter, setFilter] = useState("")

  const visible = useMemo(() => {
    if (!filter.trim()) return headings
    const needle = filter.trim().toLowerCase()
    return headings.filter((heading) => heading.text.toLowerCase().includes(needle))
  }, [filter, headings])

  useEffect(() => {
    if (!headings.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id)
          }
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    )
    for (const heading of headings) {
      const element = document.getElementById(heading.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [headings, filter])

  useEffect(() => {
    function onScroll() {
      const scrollTop = window.scrollY
      const height = document.documentElement.scrollHeight - window.innerHeight
      setProgress(height > 0 ? Math.min(100, (scrollTop / height) * 100) : 0)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  if (!headings.length) return null

  return (
    <div className="docs-scrollbar sticky top-14 hidden max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-8 pl-6 xl:block" aria-label="On this page">
      <div className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
      </div>
      <p className="mb-2 flex items-center justify-between text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
        On this page
        <span className="font-mono tabular-nums normal-case tracking-normal" aria-live="polite">{Math.round(progress)}%</span>
      </p>
      {headings.length > 8 ? (
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter headings…"
          aria-label="Filter headings on this page"
          className="mb-2 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
      ) : null}
      <ul>
        {visible.map((heading) => (
          <li key={heading.id}>
            <a href={`#${heading.id}`} className="docs-toc-link" data-level={heading.level} data-active={heading.id === active}>
              {heading.text}
            </a>
          </li>
        ))}
        {visible.length === 0 ? <li className="px-3 py-2 text-xs text-muted-foreground">No matching headings</li> : null}
      </ul>
    </div>
  )
}
