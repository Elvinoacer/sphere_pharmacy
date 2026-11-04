import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.sphere_pharmacy_PRISMA_DATABASE_URL ??
  process.env.sphere_pharmacy_DATABASE_URL ??
  process.env.sphere_pharmacy_POSTGRES_URL

if (!databaseUrl) {
  throw new Error(
    "Database configuration missing. Set DATABASE_URL, sphere_pharmacy_PRISMA_DATABASE_URL, sphere_pharmacy_DATABASE_URL, or sphere_pharmacy_POSTGRES_URL."
  )
}

/**
 * Neon pooled endpoints use PgBouncer. Disabling Prisma's client-side prepared
 * statement cache prevents stale plans from surviving a schema change and
 * failing with PostgreSQL error 0A000 ("cached plan must not change result
 * type"). Keep an explicitly configured cache size untouched.
 */
function databaseUrlForPrisma(value: string) {
  try {
    const url = new URL(value)
    if (url.hostname.includes("-pooler.") && !url.searchParams.has("statement_cache_size")) {
      url.searchParams.set("statement_cache_size", "0")
    }
    return url.toString()
  } catch {
    // Let Prisma report malformed connection strings with its normal error.
    return value
  }
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrlForPrisma(databaseUrl),
    log: ["warn", "error"],
  })

// Enable prisma.productCategory alias to category for blueprint compatibility
if (!(db as any).productCategory) {
  Object.defineProperty(db, "productCategory", {
    get() {
      return (this as any).category
    },
    configurable: true,
  })
}

globalForPrisma.prisma = db

export const prisma = db

