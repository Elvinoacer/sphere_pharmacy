import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("production configuration does not bypass build validation", () => {
  const config = read("next.config.ts")
  assert.doesNotMatch(config, /ignoreBuildErrors|ignoreDuringBuilds/)
  assert.match(read(".github/workflows/ci.yml"), /migrate deploy/)
})

test("private prescription storage and one-time OTP contracts are present", () => {
  assert.match(read("src/lib/r2.ts"), /private, no-store/)
  assert.doesNotMatch(read("src/app/api/auth/otp/request/route.ts"), /demoCode/)
  assert.match(read("prisma/schema.prisma"), /codeHash\s+String/)
})

test("payment callbacks authenticate and verify provider state", () => {
  assert.match(read("src/app/api/payments/intasend/webhook/route.ts"), /verifyIntaSendWebhook/)
  assert.match(read("src/app/api/payments/mpesa/callback/route.ts"), /MPESA_CALLBACK_TOKEN/)
})

test("deep-link routes and release migration exist", () => {
  assert.ok(existsSync(new URL("../src/app/[...route]/page.tsx", import.meta.url)))
  assert.ok(existsSync(new URL("../prisma/migrations/20260903000000_security_hardening/migration.sql", import.meta.url)))
})

test("popular product card has no nested interactive controls", () => {
  const card = read("src/components/shared/premium-popular-card.tsx")
  assert.doesNotMatch(card, /className="block w-full text-left"/)
})

test("legacy staff password migration cannot block a valid login", () => {
  const route = read("src/app/api/auth/staff-login/route.ts")
  assert.match(route, /!validatePassword\(password\)/)
  assert.match(route, /await createSession/)
})

test("admin product selects render above dialogs and forms remain scrollable", () => {
  assert.match(read("src/components/ui/select.tsx"), /z-\[100\]/)
  const catalogue = read("src/components/views/admin/sections/catalogue-section.tsx")
  assert.match(catalogue, /overflow-y-auto overscroll-contain/)
  assert.match(catalogue, /Choose a category\./)
})

test("product image library is lazy and progressively rendered", () => {
  const catalogue = read("src/components/views/admin/sections/catalogue-section.tsx")
  assert.match(catalogue, /Browse gallery/)
  assert.match(catalogue, /useState\(24\)/)
  assert.match(catalogue, /visibleImages\.map/)
  assert.match(catalogue, /added to the reusable gallery/)
})

test("catalogue category labels hide image paths and products support useful sorting", () => {
  const catalogue = read("src/components/views/admin/sections/catalogue-section.tsx")
  assert.doesNotMatch(catalogue, /c\.icon \? `\$\{c\.icon\}/)
  assert.match(catalogue, /Name: A to Z/)
  assert.match(catalogue, /Date: newest first/)
  assert.match(catalogue, /Stock: highest first/)
})

test("browser push obtains and stores a real Firebase registration token", () => {
  const client = read("src/lib/firebase/client.ts")
  assert.match(client, /getToken\(messaging/)
  assert.match(client, /serviceWorkerRegistration: registration/)
  assert.match(client, /NEXT_PUBLIC_FIREBASE_VAPID_KEY/)
  assert.doesNotMatch(client, /return false\s*\n}/)
  assert.doesNotMatch(client, /dev_fcm_/)

  const worker = read("public/firebase-messaging-sw.js")
  assert.match(worker, /PUSH_NOTIFICATION/)
  assert.match(worker, /showNotification/)
})

test("authenticated navigation sticks flush to the viewport top", () => {
  const admin = read("src/components/views/admin/admin-view.tsx")
  assert.match(admin, /admin-sidebar sticky top-0/)
  assert.doesNotMatch(admin, /admin-sidebar sticky top-32/)

  const experience = read("src/app/app-experience.css")
  assert.match(experience, /\.admin-topbar\s*\{[^}]*position: sticky;[^}]*top: 0;/)
  assert.doesNotMatch(experience, /\.admin-topbar\s*\{[^}]*top: (?:4\.25rem|4\.5rem|7\.125rem);/)

  const globals = read("src/app/globals.css")
  assert.match(globals, /\.customer-hub\s*\{[^}]*position: sticky;[^}]*top: 0;/)
})

test("medicine listings use server-side pagination", () => {
  const catalogue = read("src/components/views/admin/sections/catalogue-section.tsx")
  assert.match(catalogue, /ADMIN_PAGE_SIZE = 25/)
  assert.match(catalogue, /Page \{page\} of \{totalPages\}/)
  assert.match(catalogue, /admin: "yes"/)
  assert.doesNotMatch(catalogue, /pageSize: 200/)

  const route = read("src/app/api/products/route.ts")
  assert.match(route, /skip: \(page - 1\) \* pageSize/)
  assert.match(route, /adminView/)
  assert.match(route, /Staff access required/)
})

test("promotion editor remains usable on short and mobile viewports", () => {
  const promotions = read("src/components/views/admin/sections/promotions-section.tsx")
  assert.match(promotions, /h-\[calc\(100dvh-1rem\)\]/)
  assert.match(promotions, /min-h-0 flex-1 overflow-y-auto overscroll-contain/)
  assert.match(promotions, /shrink-0[^"\n]*border-t/)
  assert.match(promotions, /pb-\[max\(\.75rem,env\(safe-area-inset-bottom\)\)\]/)
  assert.match(promotions, /w-full sm:w-auto/)
})

test("order detail drawer exposes all content on mobile", () => {
  const orders = read("src/components/views/admin/sections/orders-section.tsx")
  assert.match(orders, /flex h-dvh w-full max-w-none/)
  assert.match(orders, /min-h-0 flex-1 overflow-y-auto overscroll-contain/)
  assert.match(orders, /max-h-\[40dvh\] shrink-0/)
  assert.match(orders, /safe-area-inset-bottom/)
  assert.match(orders, /break-all text-sm font-medium/)
})

test("notification integration tests report real provider outcomes", () => {
  const route = read("src/app/api/notifications/dispatch-test/route.ts")
  assert.doesNotMatch(route, /ENABLE_NOTIFICATION_TESTS/)
  assert.match(route, /No push-enabled device is registered/)
  assert.match(route, /status: ok \? 200 : 422/)
  assert.match(route, /push\.success === true/)

  const settings = read("src/components/views/admin/sections/settings-section.tsx")
  assert.match(settings, /res\.ok && data\.ok/)
  assert.match(settings, /data\.message \|\| data\.error/)
})

test("catalog desktop sidebar is independently scrollable and reveals filters without scrolling to catalogue end", () => {
  const catalog = read("src/components/views/catalog-view.tsx")
  assert.doesNotMatch(catalog, /Card className="sticky top-36/)
  assert.match(catalog, /sticky top-6/)
  assert.match(catalog, /max-h-\[calc\(100dvh-2\.5rem\)\]/)
  assert.match(catalog, /overflow-y-auto overscroll-contain/)
  assert.match(catalog, /scroll-slim/)
  assert.match(catalog, /Prescription filter/)
  assert.match(catalog, /Filter by availability/)
  assert.match(catalog, /Sort products/)
  assert.match(catalog, /aria-expanded=\{categoriesOpen\}/)
})

test("database client defers missing-URL throw to runtime property access and docs loader avoids root-wide tracing", () => {
  const dbSource = read("src/lib/db.ts")
  assert.match(dbSource, /new Proxy/)
  assert.match(dbSource, /Database configuration missing/)

  const docsContent = read("src/lib/docs/content.ts")
  assert.doesNotMatch(docsContent, /join\(ROOT,\s*sourcePath\)/)
  assert.doesNotMatch(docsContent, /resolve\(ROOT,/)
  assert.match(docsContent, /join\(ROOT,\s*"docs",\s*rel\)/)
})
