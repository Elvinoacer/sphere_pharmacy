import "server-only"

import { readFileSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"

/**
 * OpenAPI loader — `openapi/sphere-api.yaml` is the machine-readable contract.
 * Parsed once per process and used by the API reference page and search.
 */

const ROOT = process.cwd()
const SPEC_PATH = join(ROOT, "openapi", "sphere-api.yaml")

export interface ApiParameter {
  name: string
  in: string
  required: boolean
  description: string
  schema: string
}

export interface ApiResponse {
  status: string
  description: string
  schema: string
}

export interface ApiEndpoint {
  method: string
  path: string
  operationId: string | null
  summary: string
  description: string
  tags: string[]
  /** security requirement summary, e.g. "customer", "staff: ADMIN, PHARMACIST", "cron secret" */
  auth: string
  parameters: ApiParameter[]
  requestBody: string | null
  responses: ApiResponse[]
  rateLimit: string | null
  anchor: string
}

export interface ApiTag {
  name: string
  description: string
}

export interface OpenApiSpec {
  title: string
  version: string
  description: string
  tags: ApiTag[]
  endpoints: ApiEndpoint[]
  schemaCount: number
  pathCount: number
}

type YamlValue = Record<string, unknown>

function asRecord(value: unknown): YamlValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as YamlValue) : {}
}

function schemaToText(schema: unknown, spec: YamlValue, depth = 0): string {
  if (depth > 3) return "…"
  const record = asRecord(schema)
  if (typeof record.$ref === "string") {
    const name = record.$ref.split("/").pop() || record.$ref
    const component = asRecord(asRecord(spec.components)?.schemas)?.[name]
    return component ? `${name} = ${schemaToText(component, spec, depth + 1)}` : name
  }
  if (Array.isArray(record.enum)) return `enum: ${record.enum.join(" | ")}`
  if (record.type === "array") {
    return `array<${schemaToText(record.items, spec, depth + 1)}>`
  }
  if (record.type === "object" && record.properties) {
    const props = asRecord(record.properties)
    const required = Array.isArray(record.required) ? (record.required as string[]) : []
    const fields = Object.entries(props)
      .slice(0, 14)
      .map(([name, prop]) => `${name}${required.includes(name) ? "" : "?"}:${schemaToText(prop, spec, depth + 1)}`)
    return `{ ${fields.join(", ")}${Object.keys(props).length > 14 ? ", …" : ""} }`
  }
  if (Array.isArray(record.oneOf)) {
    return record.oneOf.map((v) => schemaToText(v, spec, depth + 1)).join(" | ")
  }
  return typeof record.type === "string" ? record.type : "any"
}

function describeSecurity(security: unknown): string {
  const list = Array.isArray(security) ? security : security ? [security] : []
  const names = list.map((item) => Object.keys(asRecord(item))[0]).filter(Boolean)
  if (!names.length) return "public"
  return names
    .map((name) => {
      if (name === "sessionCookie") return "customer session"
      if (name === "staffSession") return "staff session"
      if (name === "cronSecret") return "CRON_SECRET bearer"
      if (name === "bandagoKey") return "BandaGo API key"
      if (name === "callbackToken") return "provider callback token"
      return name
    })
    .join(" or ")
}

function extractRateLimit(description: string): string | null {
  const match = /([Rr]ate limit[^.\n]*|(\d+\s*requests?[^\n]*?per[^\n]*?))/.exec(description)
  return match ? match[0].replace(/\n/g, " ").trim().slice(0, 140) : null
}

let specCache: OpenApiSpec | null = null

export function parseOpenApi(): OpenApiSpec {
  if (specCache) return specCache
  const raw = readFileSync(SPEC_PATH, "utf8")
  const spec = yaml.load(raw) as YamlValue
  const info = asRecord(spec.info)
  const tags: ApiTag[] = (Array.isArray(spec.tags) ? spec.tags : []).map((t) => {
    const record = asRecord(t)
    return { name: String(record.name || ""), description: String(record.description || "") }
  })
  const endpoints: ApiEndpoint[] = []
  const paths = asRecord(spec.paths)
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemRaw)
    for (const method of ["get", "post", "patch", "put", "delete", "head"] as const) {
      const operationRaw = pathItem[method]
      if (!operationRaw) continue
      const operation = asRecord(operationRaw)
      const summary = String(operation.summary || pathItem.summary || "")
      const description = String(operation.description || "")
      const parameters: ApiParameter[] = (Array.isArray(operation.parameters) ? operation.parameters : [])
        .map((p) => asRecord(p))
        .map((p) => ({
          name: String(p.name || ""),
          in: String(p.in || ""),
          required: Boolean(p.required),
          description: String(p.description || "").slice(0, 300),
          schema: schemaToText(p.schema, spec),
        }))
      let requestBody: string | null = null
      const requestBodyRaw = asRecord(operation.requestBody)
      if (requestBodyRaw.content) {
        const content = asRecord(requestBodyRaw.content)
        const json = asRecord(content["application/json"])
        if (json.schema) requestBody = schemaToText(json.schema, spec)
      }
      const responses: ApiResponse[] = Object.entries(asRecord(operation.responses)).map(([status, responseRaw]) => {
        const response = asRecord(responseRaw)
        const responseContent = asRecord(asRecord(response.content)?.["application/json"])
        return {
          status,
          description: String(response.description || "").slice(0, 200),
          schema: responseContent.schema ? schemaToText(responseContent.schema, spec) : "",
        }
      })
      const pathSlug = path.replace(/[{}]/g, "").replace(/\//g, "-").replace(/^-/, "")
      endpoints.push({
        method: method.toUpperCase(),
        path,
        operationId: typeof operation.operationId === "string" ? operation.operationId : null,
        summary,
        description,
        tags: (Array.isArray(operation.tags) ? operation.tags : []).map(String),
        auth: describeSecurity(operation.security ?? pathItem.security ?? spec.security),
        parameters,
        requestBody,
        responses,
        rateLimit: extractRateLimit(description),
        anchor: `op-${method.toLowerCase()}-${pathSlug}`.toLowerCase(),
      })
    }
  }
  specCache = {
    title: String(info.title || "API"),
    version: String(info.version || ""),
    description: String(info.description || ""),
    tags,
    endpoints,
    schemaCount: Object.keys(asRecord(asRecord(spec.components)?.schemas)).length,
    pathCount: Object.keys(paths).length,
  }
  return specCache
}
