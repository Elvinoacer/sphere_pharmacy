import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { BandaGoCrmReconciler } from '@/lib/crm/bandago-crm';
import { requireStaff } from '@/lib/session';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.BANDAGO_SYNC_API_KEY;

    const isBearerValid = Boolean(expectedSecret && authHeader === `Bearer ${expectedSecret}`);
    if (!isBearerValid) {
      const { session, error } = await requireStaff(['ADMIN', 'PHARMACIST']);
      if (error || !session) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid POS CRM Credentials' },
          { status: 401 }
        );
      }
    }

    const payload = await req.json().catch(() => ({}));
    const rawCustomers = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.customers)
      ? payload.customers
      : payload.phone
      ? [payload]
      : [];

    if (rawCustomers.length === 0) {
      return NextResponse.json({ error: 'No customer profiles provided' }, { status: 400 });
    }

    const trigger = payload.trigger === 'EXTENSION_STREAM' ? 'EXTENSION_STREAM' : 'MANUAL_RECONCILE';
    const errors: Array<{ phone?: string; error: string }> = [];
    let reconciledCount = 0;

    for (const c of rawCustomers) {
      try {
        if (!c.phone) {
          throw new Error('Phone number is required');
        }
        await BandaGoCrmReconciler.syncCustomerProfile({
          phone: String(c.phone),
          name: c.name ? String(c.name).trim() : undefined,
          email: c.email ? String(c.email).trim() : undefined,
          externalBPartnerId: c.externalBPartnerId ? String(c.externalBPartnerId).trim() : undefined,
          loyaltyDelta: typeof c.loyaltyDelta === 'number' ? c.loyaltyDelta : undefined,
          posCreditBalance: typeof c.posCreditBalance === 'number' ? c.posCreditBalance : undefined,
          isChronicPatient: typeof c.isChronicPatient === 'boolean' ? c.isChronicPatient : undefined,
        });
        reconciledCount++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ phone: c.phone, error: message });
      }
    }

    // Telemetry log for CRM sync
    await prisma.posSyncLog.create({
      data: {
        posSource: 'BANDAGO',
        trigger,
        status: errors.length === 0 ? 'SUCCESS' : errors.length === rawCustomers.length ? 'FAILED' : 'PARTIAL',
        itemsReceived: rawCustomers.length,
        itemsUpserted: reconciledCount,
        itemsFailed: errors.length,
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
        details: errors.length > 0 ? { errors: errors.slice(0, 50) } : undefined,
      },
    });

    return NextResponse.json({
      success: true,
      reconciledCount,
      failedCount: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startTime,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to process CRM reconciliation', details: message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.BANDAGO_SYNC_API_KEY;

    const isBearerValid = Boolean(expectedSecret && authHeader === `Bearer ${expectedSecret}`);
    if (!isBearerValid) {
      const { session, error } = await requireStaff(['ADMIN', 'PHARMACIST', 'STAFF']);
      if (error || !session) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid POS CRM Credentials' },
          { status: 401 }
        );
      }
    }

    const url = new URL(req.url);

    // Support counter terminal lookup by customer phone number
    const queryPhone = url.searchParams.get('phone');
    if (queryPhone) {
      const { normalizeKenyaPhone } = await import('@/lib/bandago-normalizer');
      const canonical = normalizeKenyaPhone(queryPhone);
      const user = await prisma.user.findUnique({
        where: { phone: canonical },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          externalBPartnerId: true,
          loyaltyPoints: true,
          loyaltyPointsBalance: true,
          posCreditBalance: true,
          isChronicPatient: true,
          orders: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              reference: true,
              status: true,
              total: true,
              createdAt: true,
            },
          },
        },
      });
      if (!user) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, customer: user });
    }

    // Support counter terminal lookup by external BPartner ID
    const bpartnerId = url.searchParams.get('bpartnerId');
    if (bpartnerId) {
      const user = await prisma.user.findUnique({
        where: { externalBPartnerId: bpartnerId.trim() },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          externalBPartnerId: true,
          loyaltyPoints: true,
          loyaltyPointsBalance: true,
          posCreditBalance: true,
          isChronicPatient: true,
          orders: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              reference: true,
              status: true,
              total: true,
              createdAt: true,
            },
          },
        },
      });
      if (!user) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, customer: user });
    }

    // Default: Check chronic refill eligibility
    const days = parseInt(url.searchParams.get('daysThreshold') || '30', 10);
    const threshold = isNaN(days) || days < 1 ? 30 : days;

    const dueRefills = await BandaGoCrmReconciler.checkChronicRefillEligible(threshold);

    return NextResponse.json({
      success: true,
      count: dueRefills.length,
      daysThreshold: threshold,
      dueRefills,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to query CRM records', details: message },
      { status: 500 }
    );
  }
}
