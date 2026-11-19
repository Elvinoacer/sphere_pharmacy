import { createHash, timingSafeEqual } from 'crypto';

// SHA-256 digest of the legacy .env.example placeholder so we never embed a secret literal in source.
const INSECURE_DEFAULT_KEY_SHA256 = '67e3125bc6764e17d0364809f230b4fb7872bc8f976f6636515e03de49d5bf5a';

/**
 * Constant-time Bearer token verification for BandaGo integration routes.
 * Fails closed when the configured secret is unset or blank.
 */
export function verifyBandagoBearerHeader(
  authHeader: string | null | undefined,
  expectedSecret = process.env.BANDAGO_SYNC_API_KEY
): boolean {
  const secret = typeof expectedSecret === 'string' ? expectedSecret.trim() : '';
  if (!secret || !authHeader) {
    return false;
  }

  const expectedHeader = `Bearer ${secret}`;
  const expectedBuf = Buffer.from(expectedHeader, 'utf8');
  const providedBuf = Buffer.from(authHeader, 'utf8');

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Constant-time equality helper for pre-formatted Bearer header strings.
 */
export function timingSafeEqualStrings(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Returns true if the configured BANDAGO_SYNC_API_KEY matches the historically shipped example placeholder.
 */
export function isUsingInsecureDefaultBandagoKey(
  secret = process.env.BANDAGO_SYNC_API_KEY
): boolean {
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  if (!trimmed) return false;
  const digest = createHash('sha256').update(trimmed, 'utf8').digest('hex');
  return digest === INSECURE_DEFAULT_KEY_SHA256;
}
