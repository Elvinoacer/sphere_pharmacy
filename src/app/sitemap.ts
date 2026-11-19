import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"
  const storefront = ["", "/catalog", "/services"].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: (path ? "weekly" : "daily") as "weekly" | "daily",
    priority: path ? 0.8 : 1,
  }))
  return storefront
}
