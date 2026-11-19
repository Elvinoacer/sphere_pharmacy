import { NextResponse } from "next/server"
import { getSearchIndex } from "@/lib/docs/search"
import { requireStaff } from "@/lib/session"

/**
 * Staff-only search index for the documentation command palette.
 * Restricted to authenticated pharmacy staff (ADMIN, PHARMACIST, STAFF, RIDER).
 */
export async function GET() {
  const { error } = await requireStaff()
  if (error) return error

  const index = getSearchIndex()
  return NextResponse.json(index, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  })
}
