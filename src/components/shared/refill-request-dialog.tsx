"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { addressesApi, ordersApi, prescriptionsApi, type RequestRefillResponse } from "@/lib/api-client"
import { evaluateRefillEligibility } from "@/lib/prescriptions/refill-core"
import { formatDate, formatKES, shortRef } from "@/lib/format"
import type { AddressDTO, OrderDTO, PrescriptionDTO } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  Banknote,
  CalendarClock,
  CreditCard,
  Info,
  Loader2,
  MapPin,
  Pill,
  Repeat2,
  Smartphone,
  Store,
  Truck,
} from "lucide-react"

type RefillPaymentChoice = "MPESA" | "CARD" | "CASH"

function initialPaymentChoice(method?: string | null): RefillPaymentChoice {
  if (method === "MPESA") return "MPESA"
  if (method === "CARD") return "CARD"
  return "CASH"
}

export function RefillRequestDialog({
  rx,
  initialOrder,
  onClose,
  onCreated,
}: {
  rx: PrescriptionDTO
  initialOrder?: OrderDTO | null
  onClose: () => void
  onCreated: (res: RequestRefillResponse) => void
}) {
  const eligibility = evaluateRefillEligibility(rx)
  const sourceOrderId = eligibility.effectiveOrderId

  const [sourceOrder, setSourceOrder] = useState<OrderDTO | null>(
    initialOrder && initialOrder.id === sourceOrderId ? initialOrder : null
  )
  const [addresses, setAddresses] = useState<AddressDTO[]>([])
  const [loading, setLoading] = useState(true)

  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY">(
    initialOrder?.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP"
  )
  const [paymentChoice, setPaymentChoice] = useState<RefillPaymentChoice>(
    initialPaymentChoice(initialOrder?.paymentMethod)
  )
  // "__source__" keeps the source order's exact address/area/coordinates
  const [selectedAddressId, setSelectedAddressId] = useState<string>("__source__")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const orderPromise =
      sourceOrderId && (!initialOrder || initialOrder.id !== sourceOrderId)
        ? ordersApi.get(sourceOrderId).catch(() => null)
        : Promise.resolve(initialOrder ?? null)
    const addrPromise = addressesApi.list().catch(() => [] as AddressDTO[])

    Promise.all([orderPromise, addrPromise]).then(([loadedOrder, loadedAddresses]) => {
      if (cancelled) return
      if (loadedOrder) {
        setSourceOrder(loadedOrder)
        setFulfillment(loadedOrder.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP")
        setPaymentChoice(initialPaymentChoice(loadedOrder.paymentMethod))
        if (loadedOrder.fulfillment === "DELIVERY" && loadedOrder.deliveryAddress) {
          setSelectedAddressId("__source__")
        } else if (loadedAddresses.length > 0) {
          const preferred = loadedAddresses.find((a) => a.isDefault) ?? loadedAddresses[0]
          setSelectedAddressId(preferred.id)
        }
      } else if (loadedAddresses.length > 0) {
        const preferred = loadedAddresses.find((a) => a.isDefault) ?? loadedAddresses[0]
        setSelectedAddressId(preferred.id)
      }
      setAddresses(loadedAddresses)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [sourceOrderId, initialOrder])

  const rxItems = sourceOrder?.items.filter((item) => item.requiresPrescription) ?? []
  const hasSourceDeliveryAddress = Boolean(sourceOrder?.deliveryAddress)
  const effectiveAddressId =
    fulfillment === "DELIVERY"
      ? selectedAddressId === "__source__"
        ? hasSourceDeliveryAddress
          ? undefined
          : addresses[0]?.id
        : selectedAddressId
      : undefined
  const missingDeliveryAddress =
    fulfillment === "DELIVERY" && !hasSourceDeliveryAddress && !effectiveAddressId

  async function handleConfirm() {
    if (submitting || missingDeliveryAddress) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await prescriptionsApi.requestRefill(eligibility.rootPrescriptionId, {
        fulfillment,
        paymentMethod: paymentChoice,
        ...(fulfillment === "DELIVERY" && effectiveAddressId ? { addressId: effectiveAddressId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      toast.success(
        `Refill #${res.refillNumber} requested — order ${shortRef(res.reference)} (${formatKES(res.total)}) created`
      )
      onCreated(res)
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "Couldn't request the refill. Please try again."
      setSubmitError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const nextRefillNumber = eligibility.refillsUsed + 1

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-4 pb-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Repeat2 className="h-4 w-4 text-primary" aria-hidden />
            Request prescription refill
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-medium text-foreground">
              Refill #{nextRefillNumber} of {eligibility.refillsAllowed}
            </span>
            {eligibility.effectiveOrderReference ? (
              <span>· original order #{shortRef(eligibility.effectiveOrderReference)}</span>
            ) : null}
            {eligibility.validUntil ? (
              <span className="inline-flex items-center gap-1">
                · <CalendarClock className="h-3 w-3" aria-hidden /> valid until {formatDate(eligibility.validUntil)}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-slim flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading prescription details…
            </div>
          ) : (
            <>
              {rxItems.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Prescribed medicines to refill
                  </p>
                  <ul className="divide-y rounded-lg border text-sm">
                    {rxItems.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Pill className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                          <span className="truncate font-medium">{item.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">× {item.qty}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Fulfillment selection */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  How would you like to receive this refill?
                </Label>
                <RadioGroup
                  value={fulfillment}
                  onValueChange={(v) => setFulfillment(v as "PICKUP" | "DELIVERY")}
                  className="grid grid-cols-2 gap-2"
                >
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm transition-colors",
                      fulfillment === "PICKUP" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <RadioGroupItem value="PICKUP" id="refill-pickup" />
                    <Store className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-medium leading-tight">Store pickup</span>
                      <span className="block text-[11px] text-muted-foreground">Free</span>
                    </span>
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-sm transition-colors",
                      fulfillment === "DELIVERY" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <RadioGroupItem value="DELIVERY" id="refill-delivery" />
                    <Truck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-medium leading-tight">Delivery</span>
                      <span className="block text-[11px] text-muted-foreground">Zone fee applies</span>
                    </span>
                  </label>
                </RadioGroup>
              </div>

              {/* Delivery address picker when DELIVERY selected */}
              {fulfillment === "DELIVERY" ? (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Delivery address
                  </Label>
                  {hasSourceDeliveryAddress || addresses.length > 0 ? (
                    <RadioGroup
                      value={selectedAddressId}
                      onValueChange={setSelectedAddressId}
                      className="space-y-2"
                    >
                      {hasSourceDeliveryAddress ? (
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-colors",
                            selectedAddressId === "__source__" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                          )}
                        >
                          <RadioGroupItem value="__source__" id="refill-addr-source" className="mt-0.5" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-foreground">Original order address</span>
                            <span className="block text-muted-foreground">{sourceOrder?.deliveryAddress}</span>
                            {sourceOrder?.deliveryArea ? (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                <MapPin className="h-3 w-3" aria-hidden /> {sourceOrder.deliveryArea}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ) : null}
                      {addresses.map((addr) => (
                        <label
                          key={addr.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-xs transition-colors",
                            selectedAddressId === addr.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                          )}
                        >
                          <RadioGroupItem value={addr.id} id={`refill-addr-${addr.id}`} className="mt-0.5" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-foreground">{addr.label}</span>
                            <span className="block text-muted-foreground">{addr.text}</span>
                            {addr.area ? (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                <MapPin className="h-3 w-3" aria-hidden /> {addr.area}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  ) : (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                      No saved delivery address on file. Add one in your Account settings, or switch this refill to Store pickup.
                    </p>
                  )}
                </div>
              ) : null}

              {/* Preferred payment method */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Preferred payment method (payable after pharmacist review)
                </Label>
                <RadioGroup
                  value={paymentChoice}
                  onValueChange={(v) => setPaymentChoice(v as RefillPaymentChoice)}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                >
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors",
                      paymentChoice === "MPESA" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <RadioGroupItem value="MPESA" id="refill-pay-mpesa" />
                    <Smartphone className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="font-medium">M-Pesa</span>
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors",
                      paymentChoice === "CARD" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <RadioGroupItem value="CARD" id="refill-pay-card" />
                    <CreditCard className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="font-medium">Card</span>
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors",
                      paymentChoice === "CASH" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <RadioGroupItem value="CASH" id="refill-pay-cash" />
                    <Banknote className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="font-medium">
                      {fulfillment === "DELIVERY" ? "Cash on delivery" : "Pay at counter"}
                    </span>
                  </label>
                </RadioGroup>
              </div>

              {/* Optional note */}
              <div className="space-y-1.5">
                <Label htmlFor="refill-notes" className="text-xs font-medium">
                  Note for the pharmacist (optional)
                </Label>
                <Textarea
                  id="refill-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Same dosage as last month; call me if brand differs"
                  disabled={submitting}
                  className="text-xs"
                />
              </div>

              <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <p>
                  Refill orders are priced at current catalogue prices (plus any applicable delivery fee) and always go through pharmacist re-verification before dispensing. Cancelling or rejecting an unfulfilled refill automatically returns your refill slot.
                </p>
              </div>

              {submitError ? (
                <p className="text-xs font-medium text-destructive" role="alert">
                  {submitError}
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 border-t p-4 sm:justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={loading || submitting || missingDeliveryAddress}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Repeat2 className="h-3.5 w-3.5" aria-hidden />}
            {submitting ? "Submitting refill…" : "Confirm refill request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
