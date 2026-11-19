import "server-only"

import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Prisma schema parser for the database explorer.
 * Parses `prisma/schema.prisma` into typed model/enum records and generates
 * per-domain Mermaid erDiagram sources directly from the parsed relations,
 * so the explorer always matches the actual schema.
 */

const ROOT = process.cwd()
const SCHEMA_PATH = join(ROOT, "prisma", "schema.prisma")

export interface PrismaField {
  name: string
  type: string
  /** scalar type when the field is a relation (e.g. String for User.id) */
  relatedModel: string | null
  isList: boolean
  required: boolean
  isUnique: boolean
  isId: boolean
  default: string | null
  attributes: string[]
  comment: string | null
}

export interface PrismaIndex {
  kind: "index" | "unique"
  fields: string[]
  name: string | null
}

export interface PrismaModel {
  name: string
  tableName: string | null
  fields: PrismaField[]
  indexes: PrismaIndex[]
  comment: string | null
  domain: string
}

export interface PrismaEnum {
  name: string
  values: string[]
}

export interface ParsedSchema {
  models: PrismaModel[]
  enums: PrismaEnum[]
  datasourceProvider: string
}

/** Domain grouping mirrors docs/database/schema-overview.md (9 domains). */
const MODEL_DOMAINS: Record<string, string> = {
  User: "Identity & access",
  Address: "Identity & access",
  Session: "Identity & access",
  OtpCode: "Identity & access",
  StaffUser: "Identity & access",
  AuditLog: "Identity & access",
  RateLimitBucket: "Identity & access",
  Category: "Catalogue",
  Product: "Catalogue",
  Review: "Catalogue",
  ProductAlert: "Catalogue",
  ProductBatch: "Catalogue",
  PosSyncLog: "Catalogue",
  MedicineRequest: "Catalogue",
  Order: "Orders & fulfillment",
  OrderItem: "Orders & fulfillment",
  OrderStatusHistory: "Orders & fulfillment",
  Prescription: "Clinical",
  PrescriptionAccessLog: "Clinical",
  Service: "Clinical",
  ServiceImage: "Clinical",
  ServiceAvailability: "Clinical",
  ServiceBooking: "Clinical",
  ServiceBookingStatusHistory: "Clinical",
  ServiceReview: "Clinical",
  ServicePayment: "Payments & loyalty",
  Payment: "Payments & loyalty",
  PaymentWebhookEvent: "Payments & loyalty",
  Promotion: "Payments & loyalty",
  PromotionRedemption: "Payments & loyalty",
  LoyaltyLedger: "Payments & loyalty",
  Notification: "Messaging",
  NotificationPref: "Messaging",
  PushToken: "Messaging",
  NotificationDelivery: "Messaging",
  EmailSuppression: "Messaging",
  EmailDeliveryEvent: "Messaging",
  Setting: "Platform",
  ScheduledJobDelivery: "Platform",
}

function domainFor(model: string): string {
  return MODEL_DOMAINS[model] ?? "Platform"
}

let schemaCache: ParsedSchema | null = null

export function parsePrismaSchema(): ParsedSchema {
  if (schemaCache) return schemaCache
  const raw = readFileSync(SCHEMA_PATH, "utf8")
  const lines = raw.split("\n")

  const models: PrismaModel[] = []
  const enums: PrismaEnum[] = []
  let datasourceProvider = "postgresql"

  let mode: "none" | "model" | "enum" = "none"
  let currentModel: PrismaModel | null = null
  let currentEnum: PrismaEnum | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (mode === "none") {
      const providerMatch = /^provider\s*=\s*"(\w+)"/.exec(line)
      if (providerMatch) datasourceProvider = providerMatch[1]
      const modelMatch = /^model\s+(\w+)\s*\{/.exec(line)
      if (modelMatch) {
        currentModel = { name: modelMatch[1], tableName: null, fields: [], indexes: [], comment: null, domain: domainFor(modelMatch[1]) }
        mode = "model"
        continue
      }
      const enumMatch = /^enum\s+(\w+)\s*\{/.exec(line)
      if (enumMatch) {
        currentEnum = { name: enumMatch[1], values: [] }
        mode = "enum"
        continue
      }
      continue
    }
    if (line === "}") {
      if (mode === "model" && currentModel) models.push(currentModel)
      if (mode === "enum" && currentEnum) enums.push(currentEnum)
      currentModel = null
      currentEnum = null
      mode = "none"
      continue
    }
    if (line.startsWith("//")) continue
    if (mode === "enum" && currentEnum) {
      if (line && !line.startsWith("//")) currentEnum.values.push(line)
      continue
    }
    if (mode === "model" && currentModel) {
      const attrMatch = /^@@(\w+)(?:\((.*)\))?\s*(?:\/\/(.*))?$/.exec(line)
      if (attrMatch) {
        const kind = attrMatch[1] === "unique" ? "unique" : "index"
        const args = attrMatch[2] || ""
        const fieldMatches = [...args.matchAll(/\[([^\]]*)\]|(\w+)/g)]
          .map((m) => (m[1] ? m[1] : m[2]))
          .filter(Boolean)
          .map((s) => String(s).split(",")[0].trim())
        const nameMatch = /name:\s*"([^"]+)"/.exec(args)
        currentModel.indexes.push({
          kind,
          fields: fieldMatches.filter((f) => !f.includes(":")),
          name: nameMatch ? nameMatch[1] : null,
        })
        continue
      }
      const mapMatch = /^@@map\("([^"]+)"\)/.exec(line)
      if (mapMatch) {
        currentModel.tableName = mapMatch[1]
        continue
      }
      const fieldMatch = /^(\w+)\s+([\w\[\]?]+)(.*)$/.exec(line)
      if (fieldMatch) {
        const [, name, type, rest] = fieldMatch
        const isList = type.includes("[")
        const required = !type.includes("?")
        const knownScalar = new Set([
          "String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes",
        ])
        const baseType = type.replace(/[\[\]?]/g, "")
        const relatedModel = knownScalar.has(baseType) || enums.some((e) => e.name === baseType) ? null : baseType
        const attributes: string[] = []
        let isUnique = false
        let isId = false
        let defaultValue: string | null = null
        const attrInline = [...rest.matchAll(/@(\w+)(?:\(([^)]*)\))?/g)]
        for (const attr of attrInline) {
          const attrName = attr[1]
          if (attrName === "id") isId = true
          if (attrName === "unique") isUnique = true
          if (attrName === "default") defaultValue = (attr[2] || "").trim()
          if (["default", "unique", "id", "updatedAt", "createdAt", "relation"].includes(attrName)) continue
          attributes.push(attrName)
        }
        const commentMatch = /\/\/\s*(.*)$/.exec(rawLine)
        currentModel.fields.push({
          name,
          type: baseType,
          relatedModel,
          isList,
          required,
          isUnique,
          isId,
          default: defaultValue,
          attributes,
          comment: commentMatch ? commentMatch[1].trim() : null,
        })
      }
    }
  }

  schemaCache = { models, enums, datasourceProvider }
  return schemaCache
}

export interface DomainGroup {
  domain: string
  models: PrismaModel[]
}

export function groupByDomain(models: PrismaModel[]): DomainGroup[] {
  const groups = new Map<string, PrismaModel[]>()
  for (const model of models) {
    const list = groups.get(model.domain) ?? []
    list.push(model)
    groups.set(model.domain, list)
  }
  return [...groups.entries()]
    .map(([domain, list]) => ({ domain, models: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.domain.localeCompare(b.domain))
}

const RELATION_LABELS: Record<string, string> = {
  User: "user",
  Order: "order",
  Product: "product",
  Prescription: "prescription",
  Payment: "payment",
  Address: "address",
  Category: "category",
  Session: "session",
  StaffUser: "staff",
  Service: "service",
  ServiceBooking: "booking",
  Promotion: "promotion",
  Notification: "notification",
}

/** Generate a Mermaid erDiagram for a set of models (used per domain). */
export function erDiagramFor(group: DomainGroup, allModels: PrismaModel[]): string {
  const names = new Set(group.models.map((m) => m.name))
  const lines: string[] = ["erDiagram"]
  const shown = new Set<string>()
  for (const model of group.models) {
    lines.push(`  ${model.name} {`)
    for (const field of model.fields.slice(0, 8)) {
      if (field.relatedModel) continue
      const kind = field.isId ? "PK" : field.isUnique ? "UK" : ""
      lines.push(`    ${field.type} ${field.name}${kind ? " " + kind : ""}`)
    }
    lines.push("  }")
    shown.add(model.name)
    for (const field of model.fields) {
      if (!field.relatedModel || !names.has(field.relatedModel)) continue
      const cardinality = field.isList ? "||--o{" : "||--o|"
      lines.push(`  ${model.name} ${cardinality} ${field.relatedModel} : ${RELATION_LABELS[field.relatedModel] ?? field.relatedModel.toLowerCase()}`)
    }
  }
  void allModels
  return lines.join("\n")
}
