import { NextResponse } from "next/server"
import { getSearchIndex } from "@/lib/docs/search"

/**
 * Build-time search index for the documentation command palette.
 * The index is generated from the corpus; GET handlers like this one are
 * statically optimized by Next.js, so the payload is computed once at build.
 */
export async function GET() {
  const index = getSearchIndex()
  return NextResponse.json(index, {
    headers: {
      "Cache-Control": "public, max-age=600, stale-while-revalidate=86400",
    },
  })
}
