import { requireStaff, type ResolvedSession } from '@/lib/session';
import type { Role } from '@/lib/constants';
import {
  isUsingInsecureDefaultBandagoKey,
  timingSafeEqualStrings,
  verifyBandagoBearerHeader,
} from './bandago-bearer';

export {
  isUsingInsecureDefaultBandagoKey,
  timingSafeEqualStrings,
  verifyBandagoBearerHeader,
};

export type BandagoAuthResult =
  | { authorized: true; mode: 'BEARER'; session: null }
  | { authorized: true; mode: 'STAFF'; session: ResolvedSession }
  | { authorized: false; error: Response };

/**
 * Dual-mode authorization for BandaGo integration endpoints:
 * accepts timing-safe Bearer BANDAGO_SYNC_API_KEY OR an active staff session.
 */
export async function authorizeBandagoRequest(
  req: Request,
  allowedStaffRoles: Role[] = ['ADMIN', 'PHARMACIST']
): Promise<BandagoAuthResult> {
  const authHeader = req.headers.get('authorization');
  if (verifyBandagoBearerHeader(authHeader, process.env.BANDAGO_SYNC_API_KEY)) {
    return { authorized: true, mode: 'BEARER', session: null };
  }

  const { session, error } = await requireStaff(allowedStaffRoles);
  if (error || !session) {
    return {
      authorized: false,
      error: Response.json(
        { error: 'Unauthorized: Invalid POS Sync Credentials' },
        { status: 401 }
      ),
    };
  }

  return { authorized: true, mode: 'STAFF', session };
}
