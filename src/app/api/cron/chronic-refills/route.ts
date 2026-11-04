import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BandaGoCrmReconciler } from '@/lib/crm/bandago-crm';
import { notifyCustomer } from '@/lib/notify';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32 || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const dueRefills = await BandaGoCrmReconciler.checkChronicRefillEligible(30);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://spherepharmacy.co.ke';
    let notified = 0;

    // Throttle notifications so customers aren't messaged more than once a week for refills
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const order of dueRefills) {
      if (!order.userId) continue;

      const recentReminder = await db.notification.findFirst({
        where: {
          userId: order.userId,
          event: 'CHRONIC_REFILL_REMINDER',
          createdAt: { gte: oneWeekAgo },
        },
        select: { id: true },
      });

      if (recentReminder) continue;

      const medNames = order.items
        .filter((i) => i.requiresPrescription)
        .map((i) => i.name)
        .join(', ');

      const title = 'Prescription Refill Reminder';
      const message = `Your chronic medication (${medNames}) may be due for a refill. Tap here to re-order easily.`;
      const link = `${appUrl}/orders/${order.id}`;

      await notifyCustomer(
        order.userId,
        'CHRONIC_REFILL_REMINDER',
        title,
        message,
        'IN_APP',
        {
          link,
          metadata: { orderId: order.id, prescriptionRefill: true },
          email: order.user?.email
            ? {
                to: order.user.email,
                subject: title,
                html: `<p>Dear ${order.user.name || 'Customer'},</p><p>${message}</p><p><a href="${link}">Order Refill Now</a></p>`,
                text: `${message} Refill link: ${link}`,
              }
            : undefined,
        }
      );
      notified++;
    }

    return NextResponse.json({ ok: true, eligible: dueRefills.length, notified });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to process chronic refills', details: message }, { status: 500 });
  }
}
