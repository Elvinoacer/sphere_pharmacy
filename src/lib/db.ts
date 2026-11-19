import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function resolveDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ??
    process.env.sphere_pharmacy_PRISMA_DATABASE_URL ??
    process.env.sphere_pharmacy_DATABASE_URL ??
    process.env.sphere_pharmacy_POSTGRES_URL
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

function createPrismaClient(databaseUrl: string): PrismaClient {
  const client = new PrismaClient({
    datasourceUrl: databaseUrlForPrisma(databaseUrl),
    log: ["warn", "error"],
  })

  // Enable prisma.productCategory alias to category for blueprint compatibility
  if (!(client as any).productCategory) {
    Object.defineProperty(client, "productCategory", {
      get() {
        return (this as any).category
      },
      configurable: true,
    })
  }

  return client
}

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }
  const databaseUrl = resolveDatabaseUrl()
  if (!databaseUrl) {
    throw new Error(
      "Database configuration missing. Set DATABASE_URL, sphere_pharmacy_PRISMA_DATABASE_URL, sphere_pharmacy_DATABASE_URL, or sphere_pharmacy_POSTGRES_URL."
    )
  }
  const client = createPrismaClient(databaseUrl)
  globalForPrisma.prisma = client
  return client
}

const initialUrl = resolveDatabaseUrl()
const initialClient = initialUrl ? getClient() : undefined

export const db: PrismaClient =
  initialClient ??
  new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const client = getClient()
      const value = Reflect.get(client, prop, client)
      return typeof value === "function" ? value.bind(client) : value
    },
  })

export const prisma = db

