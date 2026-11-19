import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://spherepharmacy.co.ke"
  return { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/docs"] }, sitemap: `${base}/sitemap.xml` }
}
