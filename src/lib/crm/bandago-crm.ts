import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

/**
 * Normalizes Kenyan phone numbers to canonical E.164 (+254XXXXXXXXX) format
 */
export function normalizeKenyaPhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('0') && digits.length === 10) {
    return `+254${digits.substring(1)}`;
  }
  if (digits.startsWith('254') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.length === 9) {
    return `+254${digits}`;
  }
  return rawPhone.startsWith('+') ? `+${digits}` : `+${digits}`;
}

export class BandaGoCrmReconciler {
  /**
   * Reconciles an online shopper with BandaGo's Business Partner CRM (C_BPartner)
   */
  static async syncCustomerProfile(data: {
    phone: string;
    name?: string;
    email?: string;
    externalBPartnerId?: string;
    loyaltyDelta?: number;
    posCreditBalance?: number;
    isChronicPatient?: boolean;
  }) {
    const canonicalPhone = normalizeKenyaPhone(data.phone);
    if (!canonicalPhone) {
      throw new Error('A valid Kenya phone number is required to reconcile CRM profile');
    }

    const delta = data.loyaltyDelta || 0;
    const creditDec = data.posCreditBalance !== undefined ? new Prisma.Decimal(data.posCreditBalance) : undefined;

    // Guard against unique constraint collision on email with other users
    let safeEmail: string | undefined = data.email ? data.email.trim().toLowerCase() : undefined;
    if (safeEmail) {
      const existingWithEmail = await prisma.user.findUnique({
        where: { email: safeEmail },
        select: { id: true, phone: true },
      });
      if (existingWithEmail && existingWithEmail.phone !== canonicalPhone) {
        safeEmail = undefined;
      }
    }

    // Safely re-link externalBPartnerId if phone changed in POS
    const safeBPartnerId: string | undefined = data.externalBPartnerId ? data.externalBPartnerId.trim() : undefined;
    if (safeBPartnerId) {
      const existingWithBPartner = await prisma.user.findUnique({
        where: { externalBPartnerId: safeBPartnerId },
        select: { id: true, phone: true },
      });
      if (existingWithBPartner && existingWithBPartner.phone !== canonicalPhone) {
        await prisma.user.update({
          where: { id: existingWithBPartner.id },
          data: { externalBPartnerId: null },
        });
      }
    }

    return await prisma.user.upsert({
      where: { phone: canonicalPhone },
      update: {
        name: data.name || undefined,
        email: safeEmail || undefined,
        externalBPartnerId: safeBPartnerId || undefined,
        isChronicPatient: data.isChronicPatient !== undefined ? data.isChronicPatient : undefined,
        posCreditBalance: creditDec,
        loyaltyPoints: delta ? { increment: delta } : undefined,
        loyaltyPointsBalance: delta ? { increment: delta } : undefined,
      },
      create: {
        phone: canonicalPhone,
        name: data.name || 'Pharmacy Customer',
        email: safeEmail || null,
        externalBPartnerId: safeBPartnerId || null,
        isChronicPatient: data.isChronicPatient || false,
        posCreditBalance: creditDec || new Prisma.Decimal(0.0),
        loyaltyPoints: Math.max(0, delta),
        loyaltyPointsBalance: Math.max(0, delta),
      },
    });
  }

  /**
   * Checks for chronic prescription refill opportunities
   * Finds orders delivered/completed ~30 days ago that included prescription medication,
   * excluding patients who have already refilled their prescription in the interim.
   */
  static async checkChronicRefillEligible(daysThreshold = 30) {
    const cutoffDate = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);

    const dueRefills = await prisma.order.findMany({
      where: {
        createdAt: { lte: cutoffDate },
        status: { in: ['DELIVERED', 'COMPLETED_DELIVERY', 'COMPLETED_PICKUP'] },
        items: {
          some: {
            requiresPrescription: true,
          },
        },
      },
      include: {
        user: true,
        items: {
          select: {
            id: true,
            productId: true,
            name: true,
            price: true,
            qty: true,
            requiresPrescription: true,
            lineTotal: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (dueRefills.length === 0) return [];

    // Filter out orders for patients who have already placed a newer prescription order
    const eligibleOrders: typeof dueRefills = [];
    const seenUsers = new Set<string>();

    for (const order of dueRefills) {
      const userKey = order.userId || order.guestPhone || order.id;
      if (seenUsers.has(userKey)) continue;
      seenUsers.add(userKey);

      const hasNewerOrder = await prisma.order.findFirst({
        where: {
          ...(order.userId ? { userId: order.userId } : { guestPhone: order.guestPhone }),
          createdAt: { gt: cutoffDate },
          status: { notIn: ['CANCELLED', 'REJECTED'] },
          items: {
            some: {
              requiresPrescription: true,
            },
          },
        },
        select: { id: true },
      });

      if (!hasNewerOrder) {
        eligibleOrders.push(order);
      }
    }

    return eligibleOrders;
  }
}
