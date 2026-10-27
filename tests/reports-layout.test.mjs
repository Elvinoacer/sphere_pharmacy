import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const reports = readFileSync(new URL("../src/components/views/admin/sections/reports-section.tsx", import.meta.url), "utf8")

test("top products use bounded native scrolling instead of an unconstrained radix viewport", () => {
  assert.doesNotMatch(reports, /<ScrollArea[^>]*max-h/)
  assert.match(reports, /max-h-\[22rem\][^"]*overflow-y-auto/)
  assert.match(reports, /aria-label="Top products ranking"/)
  assert.match(reports, /min-w-0 overflow-hidden lg:col-span-3/)
})

test("top products table truncates lengthy names and allows horizontal scrolling in narrow panels", () => {
  assert.match(reports, /<Table className="min-w-\[26rem\] table-fixed">/)
  assert.match(reports, /<span className="block truncate" title=\{p\.name\}>/)
  assert.match(reports, /min-w-0 overflow-hidden lg:col-span-2/)
  assert.match(reports, /Order funnel — counts by status/)
})
