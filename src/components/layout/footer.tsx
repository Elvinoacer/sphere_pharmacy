"use client"

import { Separator } from "@/components/ui/separator"
import { LogoFull } from "@/components/shared/logo"
import { PHARMACY } from "@/lib/constants"
import { useAppStore } from "@/store/use-app-store"
import { Phone, MapPin, Clock, Mail, LayoutDashboard, ShieldAlert, MessageCircle } from "lucide-react"

export function Footer() {
  const navigate = useAppStore((s) => s.navigate)

  return (
    <footer className="premium-footer mt-auto pb-16 md:pb-0">
      <div className="premium-footer-line" aria-hidden />
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          {/* brand */}
          <div className="space-y-3">
            <div className="premium-footer-brand" aria-label="Sphere Pharmacy">
              <LogoFull className="premium-footer-logo" />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Thoughtful pharmacy care on Lumumba Drive—medicines, prescriptions, and local delivery in one trusted place.
            </p>
            <div className="flex gap-2 pt-1">
              <a
                href={`https://wa.me/${PHARMACY.whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/10 px-3 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-600/20 dark:text-emerald-400"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
              </a>
              <a
                href={`tel:${PHARMACY.phone}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                <Phone className="h-3.5 w-3.5" aria-hidden /> Call us
              </a>
            </div>
          </div>

          {/* contact */}
          <div className="space-y-2.5 text-sm">
            <h4 className="font-semibold">Contact</h4>
            <a href={`tel:${PHARMACY.phone}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <Phone className="h-4 w-4 shrink-0" /> {PHARMACY.phoneDisplay}
            </a>
            <a href={`mailto:${PHARMACY.email}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <Mail className="h-4 w-4 shrink-0" /> {PHARMACY.email}
            </a>
            <a href={PHARMACY.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <MapPin className="h-4 w-4 shrink-0" /> Get directions
            </a>
          </div>

          {/* hours + compliance */}
          <div className="space-y-2.5 text-sm">
            <h4 className="font-semibold">Opening hours</h4>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" /> Daily: 8:00 AM – 10:30 PM
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Holiday hours may differ — confirmed by the pharmacy. Prescriptions are reviewed during opening hours.
            </p>
            <p className="flex items-start gap-1.5 pt-1 text-xs leading-relaxed text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              {PHARMACY.disclaimer}
            </p>
          </div>

          {/* quick links */}
          <div className="space-y-2.5 text-sm">
            <h4 className="font-semibold">Quick links</h4>
            <button onClick={() => navigate("catalog")} className="block text-muted-foreground hover:text-foreground">Browse products</button>
            <button onClick={() => navigate("offers")} className="block text-muted-foreground hover:text-foreground">Current offers</button>
            <button onClick={() => navigate("services")} className="block text-muted-foreground hover:text-foreground">Care services</button>
            <button onClick={() => navigate("prescriptions")} className="block text-muted-foreground hover:text-foreground">Upload a prescription</button>
            <button onClick={() => navigate("orders")} className="block text-muted-foreground hover:text-foreground">Track an order</button>
            <button onClick={() => navigate("account")} className="block text-muted-foreground hover:text-foreground">My account</button>
            <button onClick={() => navigate("admin")} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <LayoutDashboard className="h-3.5 w-3.5" /> Staff dashboard
            </button>
          </div>
        </div>

        <Separator className="my-6" />

        <div className="flex flex-col items-center justify-between gap-3 text-center text-xs leading-relaxed text-muted-foreground sm:flex-row sm:text-left">
          <p>© {new Date().getFullYear()} Sphere Pharmacy · Lumumba Drive, Roysambu, Nairobi</p>
          <p className="max-w-md">
            Prescription-only medicines are dispensed only after pharmacist verification. Not medical advice — consult our pharmacy team.
          </p>
        </div>
      </div>
    </footer>
  )
}
