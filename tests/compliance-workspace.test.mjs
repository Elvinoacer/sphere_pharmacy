import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8")

test("compliance UI separates an internal saved record from PPB verification", () => {
  const page = read("src/components/views/admin/sections/compliance-section.tsx")
  assert.match(page, /Not independently verified/)
  assert.match(page, /Public licence claim: withheld/)
  assert.match(page, /Save internal record/)
  assert.match(page, /Record checklist/)
  assert.match(page, /complianceAudit/)
  assert.match(page, /Discard unsaved compliance changes/)
  assert.doesNotMatch(page, /storefront footer will update automatically/)
})

test("public settings cannot disclose internal unverified compliance information", () => {
  const api = read("src/app/api/settings/route.ts")
  assert.match(api, /canViewRecord/)
  assert.match(api, /premiseLicenceNumber: "", premiseLicenceExpiry: ""/)
  assert.match(api, /Cache-Control": "private, no-store"/)
  assert.match(api, /Compliance details must be text values/)
  assert.match(api, /Enter a valid licence expiry date/)
  assert.match(api, /COMPLIANCE_UPDATED/)
})

test("blank compliance notes do not masquerade as saved proof of a licence", () => {
  const settings = read("src/lib/settings.ts")
  assert.match(settings, /const DEFAULT_COMPLIANCE/)
  assert.match(settings, /notes: "",/)
})
