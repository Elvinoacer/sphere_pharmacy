import { NextResponse } from "next/server"
import { requireStaff } from "@/lib/session"
import { buildFullDocumentationPdf } from "@/lib/pdf/full-docs-pdf"

/**
 * Staff-only endpoint that compiles and downloads the complete Sphere Pharmacy
 * documentation corpus (all 129 Markdown documents, all 72 user journeys & 7 role maps,
 * all 126 OpenAPI 3.1 endpoints, and all 41 Prisma models & 5 enums) as a single
 * bookmarked A4 PDF file.
 */
export async function GET() {
  const { error } = await requireStaff()
  if (error) return error

  const result = buildFullDocumentationPdf()
  const dateStamp = new Date().toISOString().slice(0, 10)
  const filename = `sphere-pharmacy-full-documentation-${dateStamp}.pdf`

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Docs-Total-Pages": String(result.pageCount),
      "X-Docs-Total-Documents": String(result.docCount),
      "X-Docs-Total-Endpoints": String(result.endpointCount),
      "X-Docs-Total-Models": String(result.modelCount),
    },
  })
}
