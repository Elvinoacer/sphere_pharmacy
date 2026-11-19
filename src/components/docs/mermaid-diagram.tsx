"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { AlertTriangle, Download, Maximize2, Minimize, ZoomIn, ZoomOut } from "lucide-react"

/**
 * Client-side Mermaid renderer with zoom, pan, fullscreen and SVG export.
 * Renders lazily when scrolled into view; re-renders on theme change.
 */

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.2

export function MermaidDiagram({ code, title }: { code: string; title?: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "")
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [pannable, setPannable] = useState(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const visibleRef = useRef(false)

  const render = useCallback(async () => {
    if (!visibleRef.current) return
    try {
      const mermaid = (await import("mermaid")).default
      mermaid.initialize({
        startOnLoad: false,
        suppressErrorRendering: true,
        securityLevel: "strict",
        theme: resolvedTheme === "dark" ? "dark" : "default",
        fontFamily: "inherit",
        flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis", padding: 14 },
        sequence: { useMaxWidth: false },
        er: { useMaxWidth: false },
      })
      const id = `mmd-${reactId}`
      const { svg: rendered } = await mermaid.render(id, code)
      setSvg(rendered)
      setError(null)
      setScale(1)
      setOffset({ x: 0, y: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagram failed to render")
    }
  }, [code, reactId, resolvedTheme])

  // Legibility floor: once the rendered SVG is in the DOM, size it directly at
  // the target width — fit when possible; otherwise 80% of natural size with
  // panning enabled (the transform stays identity so layout matches visuals).
  useEffect(() => {
    if (!svg) return
    const svgEl = viewportRef.current?.querySelector("svg")
    const container = viewportRef.current
    if (!svgEl || !container) return
    const viewBox = svgEl.viewBox.baseVal
    const naturalWidth = viewBox && viewBox.width ? viewBox.width : svgEl.getBoundingClientRect().width
    if (!naturalWidth) return
    const available = container.clientWidth
    if (naturalWidth <= available) {
      svgEl.style.maxWidth = "100%"
      svgEl.style.width = `${naturalWidth}px`
      setPannable(false)
    } else {
      const floorWidth = Math.max(available, naturalWidth * 0.8)
      svgEl.style.maxWidth = "none"
      svgEl.style.width = `${floorWidth}px`
      setPannable(floorWidth > available)
    }
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [svg])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleRef.current = true
            observer.disconnect()
            void render()
          }
        }
      },
      { rootMargin: "320px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [render])

  useEffect(() => {
    if (visibleRef.current) void render()
  }, [render])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  function zoom(next: number) {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    setScale(clamped)
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    setOffset({
      x: drag.current.ox + (event.clientX - drag.current.x),
      y: drag.current.oy + (event.clientY - drag.current.y),
    })
  }

  function onPointerUp() {
    drag.current = null
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    zoom(scale + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP))
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await containerRef.current?.requestFullscreen()
    } catch {
      /* fullscreen may be denied (iframe) — the zoom controls remain available */
    }
  }

  function downloadSvg() {
    if (!svg) return
    const blob = new Blob([svg], { type: "image/svg+xml" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${(title || "diagram").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "diagram"}.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const zoomed = scale !== 1 || offset.x !== 0 || offset.y !== 0

  return (
    <figure className="docs-mermaid-frame" ref={containerRef}>
      <figcaption className="docs-mermaid-bar">
        <span className="truncate font-medium">{title || "Diagram"}</span>
        <span className="flex items-center gap-1" role="group" aria-label="Diagram controls">
          <button type="button" onClick={() => zoom(scale - SCALE_STEP)} aria-label="Zoom out" className="rounded-md p-1 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <ZoomOut className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="w-10 text-center font-mono text-[0.6875rem] tabular-nums" aria-live="polite">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoom(scale + SCALE_STEP)} aria-label="Zoom in" className="rounded-md p-1 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          </button>
          {zoomed ? (
            <button type="button" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }} aria-label="Reset zoom and pan" className="rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              Reset
            </button>
          ) : null}
          <button type="button" onClick={downloadSvg} aria-label="Download diagram as SVG" className="rounded-md p-1 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <Download className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} className="rounded-md p-1 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {fullscreen ? <Minimize className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </span>
      </figcaption>
      <div
        ref={viewportRef}
        className={`docs-mermaid-viewport docs-scrollbar ${pannable || zoomed ? "is-zoomed" : ""}`}
        style={{ background: fullscreen ? "var(--background)" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        tabIndex={0}
        role="img"
        aria-label={title ? `Diagram: ${title}${pannable ? " — drag to pan" : ""}` : "Diagram"}
      >
        {error ? (
          <div className="flex max-w-lg flex-col items-center gap-2 p-6 text-center" role="alert">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
            <p className="text-sm font-medium text-foreground">Diagram source could not be rendered</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : svg ? (
          <div
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: "center center" }}
            // Mermaid output is generated locally with securityLevel "strict" (sanitized).
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" aria-live="polite">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden />
            Rendering diagram…
          </div>
        )}
      </div>
    </figure>
  )
}
