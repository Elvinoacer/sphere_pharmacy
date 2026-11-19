import { getCorpus, type DocRecord } from "@/lib/docs/content"
import { parseOpenApi, type ApiEndpoint } from "@/lib/docs/openapi"
import { parsePrismaSchema, type PrismaEnum, type PrismaModel } from "@/lib/docs/prisma-schema"
import { plainText } from "@/lib/docs/utils"

/**
 * Zero-dependency PDF 1.4 generator for the complete Sphere Pharmacy
 * Documentation Handbook ("* everything": all 129 Markdown docs across all
 * 14 categories, all 72 user journeys & 7 role maps, all 126 OpenAPI 3.1
 * endpoints, and all 41 Prisma database models & 5 enums).
 *
 * Features:
 *  - A4 portrait layout with Type1 Helvetica, Helvetica-Bold, and Courier
 *  - Cover page with corpus metrics + Master Table of Contents
 *  - Native PDF /Outlines bookmark tree for every Part and Document
 *  - Full Markdown rendering: headings, paragraphs, bullet/numbered lists,
 *    blockquotes/callouts, tables, code blocks, and Mermaid flow diagrams
 */

export interface FullDocsPdfResult {
  buffer: Buffer
  pageCount: number
  docCount: number
  endpointCount: number
  modelCount: number
}

interface PartDefinition {
  id: string
  partNumber: number
  title: string
  subtitle: string
  docs: DocRecord[]
}

interface BookmarkEntry {
  title: string
  pageIndex: number
}

/** Normalize Unicode punctuation to printable ASCII so Type1 PDF fonts render cleanly. */
export function normalizePdfText(value: string): string {
  return value
    .replace(/\u2014/g, " -- ")
    .replace(/\u2013/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2192/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/\u2194/g, "<->")
    .replace(/\u21D2/g, "=>")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/\u2260/g, "!=")
    .replace(/\u00D7/g, "x")
    .replace(/[\u00B7\u2022\u2733]/g, "*")
    .replace(/\u2318/g, "Cmd+")
    .replace(/[\u2713\u2714]/g, "[OK]")
    .replace(/[\u2717\u2718]/g, "[X]")
    .replace(/\u00B1/g, "+/-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function pdfEscape(value: string): string {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
}

function stripInlineFormatting(line: string): string {
  return normalizePdfText(
    plainText(line)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[Image: $1 ($2)]")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1"),
  )
}

function wrapText(text: string, maxChars: number): string[] {
  const cleaned = normalizePdfText(text)
  if (!cleaned) return []
  if (cleaned.length <= maxChars) return [cleaned]

  const words = cleaned.split(" ")
  const lines: string[] = []
  let current = ""

  for (const word of words) {
    if (!word) continue
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ""
      }
      let cursor = 0
      while (cursor < word.length) {
        lines.push(word.slice(cursor, cursor + maxChars))
        cursor += maxChars
      }
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function organizeCorpusParts(): PartDefinition[] {
  const corpus = getCorpus()
  const usedUrls = new Set<string>()

  const take = (predicate: (doc: DocRecord) => boolean): DocRecord[] => {
    const matched = corpus.docs.filter((d) => !usedUrls.has(d.url) && predicate(d))
    for (const d of matched) usedUrls.add(d.url)
    return matched
  }

  const actorOrder = ["Customer", "Pharmacist", "Staff", "Admin", "Rider", "System"]

  const rawParts: Array<{ id: string; title: string; subtitle: string; docs: DocRecord[] }> = [
    {
      id: "start-and-product",
      title: "Start Here & Pharmacy Operations",
      subtitle: "Documentation index, product overview, feature catalogue, roles & permissions, and day-to-day pharmacy operations",
      docs: [
        ...take((d) => d.docsPath === "readme"),
        ...take((d) => d.category === "product"),
      ],
    },
    {
      id: "journeys",
      title: "User Journeys & Operational Role Maps",
      subtitle: "Role overviews and all end-to-end customer, pharmacist, staff, admin, rider, and system journeys",
      docs: [
        ...take((d) => d.docsPath === "journeys/README"),
        ...take((d) => d.docsPath.startsWith("journeys/roles/")),
        ...take((d) => d.isJourney).sort((a, b) => {
          const aActor = a.journey ? actorOrder.indexOf(a.journey.actor) : 99
          const bActor = b.journey ? actorOrder.indexOf(b.journey.actor) : 99
          if (aActor !== bActor) return aActor - bActor
          return a.docsPath.localeCompare(b.docsPath)
        }),
      ],
    },
    {
      id: "architecture",
      title: "System, Frontend, Backend & API Architecture",
      subtitle: "How the Next.js 16 SPA, API routes, authentication, and client/server state fit together",
      docs: take((d) => d.category === "architecture"),
    },
    {
      id: "features",
      title: "Feature Subsystem Deep-Dives",
      subtitle: "Storefront, inventory, prescriptions, orders, payments, bookings, loyalty, notifications, CRM, and AI assistant",
      docs: take((d) => d.category === "features"),
    },
    {
      id: "database",
      title: "Database Architecture, Data Dictionary & Migrations",
      subtitle: "PostgreSQL + Prisma 6 schema overview, data dictionary, ER diagrams, migrations, and data lifecycle",
      docs: take((d) => d.category === "database"),
    },
    {
      id: "api",
      title: "API Reference & Conventions",
      subtitle: "Complete HTTP route handler reference, rate limits, and idempotency key catalogue",
      docs: take((d) => d.category === "api"),
    },
    {
      id: "integrations",
      title: "External Integrations",
      subtitle: "M-Pesa Daraja, IntaSend, BandaGo POS/CRM, Cloudflare R2, Firebase FCM, Resend, and Groq AI",
      docs: take((d) => d.category === "integrations"),
    },
    {
      id: "security",
      title: "Security, Access Control & Privacy",
      subtitle: "Authorization guards, session-scoped AI access policy, R2 storage security, health-data privacy, and retention",
      docs: take((d) => d.category === "security"),
    },
    {
      id: "workflows",
      title: "Business Process State Machines & Workflows",
      subtitle: "Order, prescription, payment, inventory, and clinical service booking lifecycles",
      docs: take((d) => d.category === "workflows"),
    },
    {
      id: "operations",
      title: "Operations, Local Development & Runbooks",
      subtitle: "Local setup, environment variables, standalone deployment, database operations, scheduled jobs, backups, and troubleshooting",
      docs: take((d) => d.category === "operations"),
    },
    {
      id: "testing-and-governance",
      title: "Testing, Architecture Decisions & Governance",
      subtitle: "Testing strategy, 17 ADRs, documentation policy, technical debt ledger, and release history",
      docs: [
        ...take((d) => d.category === "testing"),
        ...take((d) => d.category === "governance"),
      ],
    },
    {
      id: "reference-and-project",
      title: "Acceptance Scripts, Audits & Repository Guides",
      subtitle: "51-scene platform recording script, payment/notification audit, root README, and AGENTS guide",
      docs: [
        ...take((d) => d.category === "recording"),
        ...take((d) => d.category === "reference"),
        ...take((d) => d.category === "project"),
        ...take(() => true), // Any remaining doc in corpus
      ],
    },
  ]

  return rawParts
    .filter((p) => p.docs.length > 0)
    .map((p, idx) => ({
      ...p,
      partNumber: idx + 1,
    }))
}

export function buildFullDocumentationPdf(): FullDocsPdfResult {
  const PAGE_W = 595.28
  const PAGE_H = 841.89
  const MARGIN_L = 40
  const MARGIN_R = 40
  const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R // ~515pt
  const TOP_Y = PAGE_H - 48
  const BOTTOM_Y = 50

  const parts = organizeCorpusParts()
  const api = parseOpenApi()
  const schema = parsePrismaSchema()
  const totalDocs = parts.reduce((acc, p) => acc + p.docs.length, 0)
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"

  const pageStreams: string[] = []
  const pageHeaders: string[] = []
  const bookmarks: BookmarkEntry[] = []

  let currentStream = ""
  let currentHeader = "Sphere Pharmacy — Complete Documentation Handbook"
  let y = TOP_Y

  const drawText = (
    x: number,
    yPos: number,
    text: string,
    size = 9,
    font: "/F1" | "/F2" | "/F3" = "/F1",
    rgb = "0.10 0.12 0.15",
  ): string => {
    const escaped = pdfEscape(text)
    if (!escaped) return ""
    return `BT ${rgb} rg ${font} ${size} Tf ${x.toFixed(2)} ${yPos.toFixed(2)} Td (${escaped}) Tj ET\n`
  }

  const drawRect = (
    x: number,
    yPos: number,
    w: number,
    h: number,
    fillRgb?: string,
    strokeRgb?: string,
  ): string => {
    let op = ""
    if (fillRgb) op += `${fillRgb} rg `
    if (strokeRgb) op += `${strokeRgb} RG 0.5 w `
    op += `${x.toFixed(2)} ${yPos.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re `
    if (fillRgb && strokeRgb) op += "B\n"
    else if (fillRgb) op += "f\n"
    else op += "S\n"
    return op
  }

  const drawLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokeRgb = "0.82 0.85 0.88",
    width = 0.5,
  ): string => {
    return `${strokeRgb} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`
  }

  const flushPage = () => {
    if (!currentStream) return
    pageStreams.push(currentStream)
    pageHeaders.push(currentHeader)
    currentStream = ""
    y = TOP_Y
  }

  const startNewPage = (headerLabel?: string) => {
    if (currentStream) flushPage()
    if (headerLabel) currentHeader = headerLabel
    // Running top header on content pages
    currentStream += drawText(MARGIN_L, PAGE_H - 28, currentHeader.slice(0, 95), 7.5, "/F2", "0.35 0.40 0.45")
    currentStream += drawLine(MARGIN_L, PAGE_H - 34, MARGIN_L + CONTENT_W, PAGE_H - 34, "0.85 0.87 0.90", 0.4)
    y = TOP_Y
  }

  const ensureSpace = (neededPt: number) => {
    if (y - neededPt < BOTTOM_Y) {
      startNewPage()
    }
  }

  // =========================================================================
  // 1. COVER PAGE & TABLE OF CONTENTS
  // =========================================================================
  bookmarks.push({ title: "Cover & Master Table of Contents", pageIndex: 0 })

  // Hero Cover Banner
  currentStream += drawRect(MARGIN_L, y - 92, CONTENT_W, 92, "0.06 0.31 0.25")
  currentStream += drawText(MARGIN_L + 16, y - 26, "SPHERE PHARMACY", 11, "/F2", "0.75 0.95 0.88")
  currentStream += drawText(
    MARGIN_L + 16,
    y - 48,
    "COMPLETE PLATFORM DOCUMENTATION HANDBOOK",
    16,
    "/F2",
    "1 1 1",
  )
  currentStream += drawText(
    MARGIN_L + 16,
    y - 66,
    "Operations, User Journeys, Architecture, Features, Database Schema, OpenAPI Contract, Security & Runbooks",
    8.5,
    "/F1",
    "0.88 0.96 0.92",
  )
  currentStream += drawText(
    MARGIN_L + 16,
    y - 81,
    `Lumumba Drive, Roysambu, Nairobi, Kenya  |  Generated: ${generatedAt}  |  Staff & Admin Reference`,
    7.8,
    "/F1",
    "0.78 0.90 0.86",
  )
  y -= 108

  // Metrics Summary Boxes
  const boxW = (CONTENT_W - 18) / 4
  const kpis = [
    { label: "CANONICAL DOCUMENTS", value: `${totalDocs} Pages` },
    { label: "USER JOURNEYS & ROLES", value: `${parts.find((p) => p.id === "journeys")?.docs.length ?? 80} Flows` },
    { label: "OPENAPI 3.1 ENDPOINTS", value: `${api.endpoints.length} Handlers` },
    { label: "PRISMA DB MODELS", value: `${schema.models.length} Models / ${schema.enums.length} Enums` },
  ]
  kpis.forEach((kpi, idx) => {
    const bx = MARGIN_L + idx * (boxW + 6)
    currentStream += drawRect(bx, y - 38, boxW, 38, "0.95 0.97 0.97", "0.80 0.85 0.84")
    currentStream += drawText(bx + 8, y - 14, kpi.label, 6.8, "/F2", "0.35 0.42 0.40")
    currentStream += drawText(bx + 8, y - 29, kpi.value, 10.5, "/F2", "0.06 0.25 0.20")
  })
  y -= 54

  // Master Table of Contents Heading
  currentStream += drawText(MARGIN_L, y, "MASTER TABLE OF CONTENTS", 12, "/F2", "0.06 0.28 0.22")
  currentStream += drawLine(MARGIN_L, y - 5, MARGIN_L + CONTENT_W, y - 5, "0.06 0.31 0.25", 0.8)
  y -= 20

  for (const part of parts) {
    ensureSpace(32)
    currentStream += drawRect(MARGIN_L, y - 14, CONTENT_W, 16, "0.93 0.96 0.95")
    currentStream += drawText(
      MARGIN_L + 6,
      y - 10,
      `PART ${part.partNumber}: ${part.title.toUpperCase()} (${part.docs.length} documents)`,
      8.5,
      "/F2",
      "0.06 0.28 0.22",
    )
    y -= 20

    for (const doc of part.docs) {
      ensureSpace(13)
      const label = doc.journey ? `${doc.journey.id} - ${doc.title}` : doc.title
      currentStream += drawText(MARGIN_L + 12, y - 8, `* ${label.slice(0, 68)}`, 7.8, "/F1", "0.15 0.18 0.22")
      currentStream += drawText(MARGIN_L + 335, y - 8, doc.sourcePath.slice(0, 44), 7.0, "/F3", "0.42 0.46 0.52")
      y -= 11.5
    }
    y -= 6
  }

  // Appendices in TOC
  ensureSpace(44)
  currentStream += drawRect(MARGIN_L, y - 14, CONTENT_W, 16, "0.93 0.96 0.95")
  currentStream += drawText(
    MARGIN_L + 6,
    y - 10,
    `APPENDIX A: MACHINE-READABLE OPENAPI 3.1 CONTRACT (${api.endpoints.length} HTTP ENDPOINTS)`,
    8.5,
    "/F2",
    "0.06 0.28 0.22",
  )
  y -= 22
  currentStream += drawRect(MARGIN_L, y - 14, CONTENT_W, 16, "0.93 0.96 0.95")
  currentStream += drawText(
    MARGIN_L + 6,
    y - 10,
    `APPENDIX B: PRISMA DATABASE SCHEMA EXPLORER (${schema.models.length} MODELS & ${schema.enums.length} ENUMS)`,
    8.5,
    "/F2",
    "0.06 0.28 0.22",
  )
  y -= 20

  // =========================================================================
  // 2. RENDER EVERY PART & EVERY DOCUMENT IN THE CORPUS
  // =========================================================================
  const renderMarkdownBody = (markdown: string) => {
    const rawLines = markdown.replace(/^#\s+.+\r?\n/, "").split(/\r?\n/)
    let inCode = false
    let codeLang = ""
    let codeBuffer: string[] = []
    let tableBuffer: string[][] = []

    const flushTable = () => {
      if (!tableBuffer.length) return
      const rows = tableBuffer.filter(
        (cells) => !cells.every((c) => /^[:\s-]+$/.test(c)),
      )
      tableBuffer = []
      if (!rows.length) return

      const colCount = Math.max(1, Math.min(6, rows[0].length))
      const colWidth = CONTENT_W / colCount
      const maxCharsPerCell = Math.max(12, Math.floor(colWidth / 4.4) - 2)

      rows.forEach((row, rIdx) => {
        const cellLines = Array.from({ length: colCount }, (_, cIdx) =>
          wrapText(stripInlineFormatting(row[cIdx] ?? ""), maxCharsPerCell).slice(0, 4),
        )
        const maxLines = Math.max(1, ...cellLines.map((cl) => cl.length))
        const rowH = maxLines * 10 + 6
        ensureSpace(rowH + 4)

        if (rIdx === 0) {
          currentStream += drawRect(MARGIN_L, y - rowH, CONTENT_W, rowH, "0.91 0.94 0.94", "0.78 0.82 0.84")
        } else if (rIdx % 2 === 1) {
          currentStream += drawRect(MARGIN_L, y - rowH, CONTENT_W, rowH, "0.98 0.985 0.99", "0.88 0.90 0.92")
        } else {
          currentStream += drawRect(MARGIN_L, y - rowH, CONTENT_W, rowH, undefined, "0.88 0.90 0.92")
        }

        for (let cIdx = 0; cIdx < colCount; cIdx++) {
          const cx = MARGIN_L + cIdx * colWidth + 4
          cellLines[cIdx].forEach((ln, lIdx) => {
            currentStream += drawText(
              cx,
              y - 10 - lIdx * 9.5,
              ln,
              7.3,
              rIdx === 0 ? "/F2" : "/F1",
              rIdx === 0 ? "0.08 0.15 0.14" : "0.16 0.20 0.24",
            )
          })
        }
        y -= rowH
      })
      y -= 6
    }

    const flushCode = () => {
      if (!codeBuffer.length) return
      const isMermaid = codeLang.toLowerCase() === "mermaid"
      const headerLabel = isMermaid ? "FLOWCHART / DIAGRAM SPECIFICATION (MERMAID)" : `CODE BLOCK (${(codeLang || "text").toUpperCase()})`

      ensureSpace(24)
      currentStream += drawRect(MARGIN_L, y - 13, CONTENT_W, 13, isMermaid ? "0.90 0.95 0.93" : "0.91 0.92 0.94")
      currentStream += drawText(MARGIN_L + 6, y - 9.5, headerLabel, 6.8, "/F2", "0.20 0.28 0.26")
      y -= 14

      for (const rawCodeLine of codeBuffer) {
        const wrapped = wrapText(rawCodeLine, 92)
        const linesToDraw = wrapped.length ? wrapped : [""]
        for (const cl of linesToDraw) {
          ensureSpace(11)
          currentStream += drawRect(MARGIN_L, y - 10.5, CONTENT_W, 10.5, "0.965 0.97 0.98")
          currentStream += drawText(MARGIN_L + 6, y - 8, cl, 7.2, "/F3", "0.14 0.18 0.24")
          y -= 10.5
        }
      }
      codeBuffer = []
      codeLang = ""
      y -= 6
    }

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim()

      // Code fences
      if (trimmed.startsWith("```")) {
        flushTable()
        if (!inCode) {
          inCode = true
          codeLang = trimmed.slice(3).trim()
          codeBuffer = []
        } else {
          inCode = false
          flushCode()
        }
        continue
      }

      if (inCode) {
        codeBuffer.push(rawLine)
        continue
      }

      // Markdown table row
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const cells = trimmed
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim())
        tableBuffer.push(cells)
        continue
      } else if (tableBuffer.length > 0) {
        flushTable()
      }

      // Blank line
      if (!trimmed || trimmed.startsWith("<!--")) {
        y -= 4
        continue
      }

      // Horizontal rule
      if (/^(?:---|\*\*\*|___)\s*$/.test(trimmed)) {
        ensureSpace(10)
        currentStream += drawLine(MARGIN_L, y - 4, MARGIN_L + CONTENT_W, y - 4, "0.82 0.85 0.88", 0.6)
        y -= 10
        continue
      }

      // Headings
      const hMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed)
      if (hMatch) {
        const level = hMatch[1].length
        const headingText = stripInlineFormatting(hMatch[2])
        const fontSize = level === 1 ? 13 : level === 2 ? 11 : level === 3 ? 9.8 : 9
        const maxChars = level <= 2 ? 75 : 85
        const wrappedH = wrapText(headingText, maxChars)
        ensureSpace(wrappedH.length * (fontSize + 3) + 18)
        y -= level <= 2 ? 6 : 4
        for (const hl of wrappedH) {
          currentStream += drawText(
            MARGIN_L,
            y - fontSize,
            hl,
            fontSize,
            "/F2",
            level <= 2 ? "0.06 0.26 0.20" : "0.10 0.15 0.20",
          )
          y -= fontSize + 3
        }
        if (level <= 2) {
          currentStream += drawLine(MARGIN_L, y, MARGIN_L + CONTENT_W, y, "0.78 0.84 0.82", 0.5)
          y -= 5
        }
        continue
      }

      // Blockquotes / Callouts
      if (trimmed.startsWith(">")) {
        const quoteText = stripInlineFormatting(trimmed.replace(/^>\s*/, ""))
        if (!quoteText) continue
        const wrappedQ = wrapText(quoteText, 92)
        for (const ql of wrappedQ) {
          ensureSpace(12)
          currentStream += drawRect(MARGIN_L + 2, y - 10, 2.5, 11, "0.06 0.38 0.30")
          currentStream += drawText(MARGIN_L + 10, y - 8, ql, 8.2, "/F1", "0.22 0.27 0.32")
          y -= 11.5
        }
        continue
      }

      // Bullet or numbered list items
      const listMatch = /^(\s*)(?:([-*+])|(\d+\.))\s+(.+)$/.exec(rawLine)
      if (listMatch) {
        const indentLevel = Math.min(3, Math.floor((listMatch[1]?.length ?? 0) / 2))
        const bullet = listMatch[3] ? listMatch[3] : "*"
        const content = stripInlineFormatting(listMatch[4])
        const indentPt = MARGIN_L + 8 + indentLevel * 12
        const maxChars = Math.max(55, 94 - indentLevel * 3)
        const wrappedL = wrapText(content, maxChars)
        wrappedL.forEach((ll, idx) => {
          ensureSpace(12)
          if (idx === 0) {
            currentStream += drawText(indentPt, y - 8.5, bullet, 8.3, "/F2", "0.06 0.31 0.25")
          }
          currentStream += drawText(indentPt + 14, y - 8.5, ll, 8.4, "/F1", "0.12 0.15 0.18")
          y -= 11.5
        })
        continue
      }

      // Standard paragraph line
      const paraLines = wrapText(stripInlineFormatting(trimmed), 96)
      for (const pl of paraLines) {
        ensureSpace(12)
        currentStream += drawText(MARGIN_L, y - 8.5, pl, 8.6, "/F1", "0.12 0.15 0.18")
        y -= 11.5
      }
    }

    flushTable()
    flushCode()
  }

  for (const part of parts) {
    startNewPage(`Part ${part.partNumber}: ${part.title}`)
    bookmarks.push({
      title: `Part ${part.partNumber}: ${part.title}`,
      pageIndex: pageStreams.length,
    })

    // Part Title Banner
    currentStream += drawRect(MARGIN_L, y - 48, CONTENT_W, 48, "0.06 0.31 0.25")
    currentStream += drawText(
      MARGIN_L + 12,
      y - 18,
      `PART ${part.partNumber}  |  ${part.title.toUpperCase()}`,
      12,
      "/F2",
      "1 1 1",
    )
    currentStream += drawText(
      MARGIN_L + 12,
      y - 35,
      `${part.subtitle} (${part.docs.length} documents)`,
      8,
      "/F1",
      "0.84 0.95 0.90",
    )
    y -= 60

    for (const doc of part.docs) {
      const docDisplayTitle = doc.journey && !doc.title.startsWith(doc.journey.id)
        ? `${doc.journey.id} - ${doc.title}`
        : doc.title

      currentHeader = `Part ${part.partNumber}: ${part.title}  |  ${docDisplayTitle}`
      ensureSpace(95)

      bookmarks.push({
        title: `  ${docDisplayTitle}`,
        pageIndex: pageStreams.length,
      })

      // Document Title Card
      currentStream += drawRect(MARGIN_L, y - 38, CONTENT_W, 38, "0.94 0.97 0.96", "0.75 0.84 0.80")
      currentStream += drawText(MARGIN_L + 10, y - 16, docDisplayTitle.slice(0, 82), 11.5, "/F2", "0.06 0.25 0.20")
      const metaLine = `Source: ${doc.sourcePath}   |   Portal URL: ${doc.url}   |   Status: ${doc.status.toUpperCase()}${doc.verified ? `   |   Verified: ${doc.verified}` : ""}`
      currentStream += drawText(MARGIN_L + 10, y - 30, metaLine.slice(0, 110), 7.2, "/F3", "0.30 0.36 0.40")
      y -= 46

      // If this document is a Journey, render its structured Journey Metadata block
      if (doc.journey) {
        const j = doc.journey
        const metaRows = [
          `Actor: ${j.actor}${j.secondaryActors.length ? ` (Secondary: ${j.secondaryActors.join(", ")})` : ""}   |   Area: ${j.area}   |   Entry: ${j.entryPoint || "-"}`,
          `Objective: ${j.objective || doc.description}`,
          j.startCondition ? `Start Condition: ${j.startCondition}   |   End Condition: ${j.endCondition || "-"}` : "",
        ].filter(Boolean)

        for (const mr of metaRows) {
          for (const wrappedMr of wrapText(mr, 96)) {
            ensureSpace(12)
            currentStream += drawText(MARGIN_L + 6, y - 8.5, wrappedMr, 7.8, "/F2", "0.18 0.26 0.24")
            y -= 11
          }
        }
        y -= 4
      }

      renderMarkdownBody(doc.body)
      y -= 14
    }
  }

  // =========================================================================
  // 3. APPENDIX A: FULL OPENAPI 3.1 ENDPOINT CATALOGUE
  // =========================================================================
  startNewPage("Appendix A: Complete OpenAPI 3.1 Endpoint Catalogue")
  bookmarks.push({
    title: `Appendix A: OpenAPI 3.1 Contract (${api.endpoints.length} Endpoints)`,
    pageIndex: pageStreams.length,
  })

  currentStream += drawRect(MARGIN_L, y - 44, CONTENT_W, 44, "0.06 0.31 0.25")
  currentStream += drawText(
    MARGIN_L + 12,
    y - 18,
    `APPENDIX A  |  OPENAPI 3.1 MACHINE-READABLE CONTRACT (${api.endpoints.length} ENDPOINTS)`,
    11.5,
    "/F2",
    "1 1 1",
  )
  currentStream += drawText(
    MARGIN_L + 12,
    y - 33,
    `Source: openapi/sphere-api.yaml (v${api.version}) — All ${api.pathCount} paths and ${api.endpoints.length} HTTP operations`,
    8,
    "/F1",
    "0.84 0.95 0.90",
  )
  y -= 56

  api.endpoints.forEach((ep: ApiEndpoint, idx: number) => {
    ensureSpace(44)
    currentStream += drawRect(MARGIN_L, y - 16, CONTENT_W, 16, "0.93 0.96 0.95", "0.80 0.85 0.84")
    currentStream += drawText(
      MARGIN_L + 6,
      y - 11,
      `${idx + 1}. [${ep.method}] ${ep.path}   (${ep.auth}${ep.rateLimit ? ` | Rate limit: ${ep.rateLimit}` : ""})`,
      8.2,
      "/F2",
      "0.06 0.26 0.20",
    )
    y -= 18

    if (ep.summary || ep.description) {
      const desc = [ep.summary, ep.description && ep.description !== ep.summary ? ep.description : ""]
        .filter(Boolean)
        .join(" — ")
      for (const dl of wrapText(desc, 95)) {
        ensureSpace(11)
        currentStream += drawText(MARGIN_L + 8, y - 8, dl, 8, "/F1", "0.15 0.18 0.22")
        y -= 10.5
      }
    }

    if (ep.parameters.length > 0) {
      const paramStr = `Parameters: ${ep.parameters.map((p) => `${p.name} (${p.in}${p.required ? ", req" : ""}: ${p.schema})`).join("; ")}`
      for (const pl of wrapText(paramStr, 95)) {
        ensureSpace(11)
        currentStream += drawText(MARGIN_L + 8, y - 8, pl, 7.4, "/F3", "0.28 0.32 0.38")
        y -= 10
      }
    }

    if (ep.responses.length > 0) {
      const respStr = `Responses: ${ep.responses.map((r) => `HTTP ${r.status}: ${r.description}`).join(" | ")}`
      for (const rl of wrapText(respStr, 95).slice(0, 3)) {
        ensureSpace(11)
        currentStream += drawText(MARGIN_L + 8, y - 8, rl, 7.4, "/F1", "0.30 0.35 0.40")
        y -= 10
      }
    }
    y -= 5
  })

  // =========================================================================
  // 4. APPENDIX B: FULL PRISMA DATABASE SCHEMA EXPLORER
  // =========================================================================
  startNewPage("Appendix B: Complete Prisma Database Schema Explorer")
  bookmarks.push({
    title: `Appendix B: Prisma Schema (${schema.models.length} Models, ${schema.enums.length} Enums)`,
    pageIndex: pageStreams.length,
  })

  currentStream += drawRect(MARGIN_L, y - 44, CONTENT_W, 44, "0.06 0.31 0.25")
  currentStream += drawText(
    MARGIN_L + 12,
    y - 18,
    `APPENDIX B  |  PRISMA DATABASE SCHEMA (${schema.models.length} MODELS & ${schema.enums.length} ENUMS)`,
    11.5,
    "/F2",
    "1 1 1",
  )
  currentStream += drawText(
    MARGIN_L + 12,
    y - 33,
    "Source: prisma/schema.prisma — Complete field, type, relation, and index dictionary",
    8,
    "/F1",
    "0.84 0.95 0.90",
  )
  y -= 56

  schema.models.forEach((model: PrismaModel, idx: number) => {
    ensureSpace(48)
    currentStream += drawRect(MARGIN_L, y - 16, CONTENT_W, 16, "0.93 0.96 0.95", "0.80 0.85 0.84")
    currentStream += drawText(
      MARGIN_L + 6,
      y - 11,
      `${idx + 1}. Model: ${model.name}   (Domain: ${model.domain} | Fields: ${model.fields.length})`,
      8.5,
      "/F2",
      "0.06 0.26 0.20",
    )
    y -= 18

    if (model.comment) {
      for (const cl of wrapText(model.comment, 95)) {
        ensureSpace(11)
        currentStream += drawText(MARGIN_L + 8, y - 8, cl, 7.8, "/F1", "0.22 0.26 0.30")
        y -= 10
      }
    }

    for (const field of model.fields) {
      ensureSpace(10.5)
      const typeLabel = `${field.type}${field.isList ? "[]" : ""}${field.required ? "" : "?"}`
      const flags = [
        field.isId ? "@id" : "",
        field.isUnique ? "@unique" : "",
        field.default ? `default=${field.default}` : "",
        field.relatedModel ? `-> ${field.relatedModel}` : "",
      ]
        .filter(Boolean)
        .join(" ")
      currentStream += drawText(MARGIN_L + 10, y - 7.5, field.name.slice(0, 28), 7.4, "/F3", "0.10 0.14 0.18")
      currentStream += drawText(MARGIN_L + 150, y - 7.5, typeLabel.slice(0, 24), 7.4, "/F2", "0.06 0.30 0.24")
      currentStream += drawText(MARGIN_L + 275, y - 7.5, flags.slice(0, 50), 7.2, "/F3", "0.35 0.40 0.45")
      y -= 10
    }
    y -= 6
  })

  if (schema.enums.length > 0) {
    ensureSpace(36)
    currentStream += drawText(MARGIN_L, y - 10, "PRISMA ENUMS", 10, "/F2", "0.06 0.26 0.20")
    y -= 16
    schema.enums.forEach((en: PrismaEnum) => {
      const line = `${en.name}: ${en.values.join(" | ")}`
      for (const wl of wrapText(line, 94)) {
        ensureSpace(11)
        currentStream += drawText(MARGIN_L + 8, y - 8, wl, 7.6, "/F3", "0.15 0.20 0.25")
        y -= 10.5
      }
    })
  }

  flushPage()

  // =========================================================================
  // 5. ASSEMBLE PDF 1.4 BINARY WITH FOOTER PAGE NUMBERS & /Outlines BOOKMARKS
  // =========================================================================
  const totalPages = pageStreams.length
  const objects: string[] = []

  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font /F1 (Helvetica)
  // 4: Font /F2 (Helvetica-Bold)
  // 5: Font /F3 (Courier)
  // 6..5+2*totalPages: Page Content Stream (6 + 2*i) and Page Dict (7 + 2*i)
  const firstPageContentId = 6
  const pageDictId = (pageIdx: number) => firstPageContentId + pageIdx * 2 + 1
  const outlinesRootId = firstPageContentId + totalPages * 2

  objects.push(`<< /Type /Catalog /Pages 2 0 R /Outlines ${outlinesRootId} 0 R /PageMode /UseOutlines >>`)
  const kidsRefs = pageStreams.map((_, i) => `${pageDictId(i)} 0 R`).join(" ")
  objects.push(`<< /Type /Pages /Kids [${kidsRefs}] /Count ${totalPages} >>`)
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")

  pageStreams.forEach((bodyStream, pageIndex) => {
    let footer = drawLine(MARGIN_L, 38, MARGIN_L + CONTENT_W, 38, "0.82 0.85 0.88", 0.4)
    footer += drawText(
      MARGIN_L,
      26,
      "Sphere Pharmacy Complete Documentation Handbook  |  Staff & Admin Internal Reference",
      7.2,
      "/F1",
      "0.42 0.46 0.52",
    )
    footer += drawText(
      PAGE_W - MARGIN_R - 68,
      26,
      `Page ${pageIndex + 1} of ${totalPages}`,
      7.4,
      "/F2",
      "0.30 0.35 0.40",
    )

    const fullStream = bodyStream + footer
    const len = Buffer.byteLength(fullStream, "utf8")
    const contentId = firstPageContentId + pageIndex * 2
    objects.push(`<< /Length ${len} >>\nstream\n${fullStream}endstream`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`,
    )
  })

  // Build PDF /Outlines bookmark objects
  if (bookmarks.length > 0) {
    const firstItemId = outlinesRootId + 1
    const lastItemId = outlinesRootId + bookmarks.length
    objects.push(
      `<< /Type /Outlines /First ${firstItemId} 0 R /Last ${lastItemId} 0 R /Count ${bookmarks.length} >>`,
    )
    bookmarks.forEach((bm, idx) => {
      const itemId = firstItemId + idx
      const prevRef = idx > 0 ? `/Prev ${itemId - 1} 0 R ` : ""
      const nextRef = idx < bookmarks.length - 1 ? `/Next ${itemId + 1} 0 R ` : ""
      const targetPageObj = pageDictId(Math.min(totalPages - 1, Math.max(0, bm.pageIndex)))
      objects.push(
        `<< /Title (${pdfEscape(bm.title.slice(0, 90))}) /Parent ${outlinesRootId} 0 R ${prevRef}${nextRef}/Dest [${targetPageObj} 0 R /XYZ 0 ${PAGE_H.toFixed(0)} null] >>`,
      )
    })
  } else {
    objects.push("<< /Type /Outlines /Count 0 >>")
  }

  // Serialize PDF binary with exact byte offsets
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "utf8")]
  const offsets: number[] = [0]
  let byteCursor = chunks[0].length

  objects.forEach((objBody, idx) => {
    offsets.push(byteCursor)
    const buf = Buffer.from(`${idx + 1} 0 obj\n${objBody}\nendobj\n`, "utf8")
    chunks.push(buf)
    byteCursor += buf.length
  })

  const xrefOffset = byteCursor
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  chunks.push(Buffer.from(xref, "utf8"))

  return {
    buffer: Buffer.concat(chunks),
    pageCount: totalPages,
    docCount: totalDocs,
    endpointCount: api.endpoints.length,
    modelCount: schema.models.length,
  }
}
