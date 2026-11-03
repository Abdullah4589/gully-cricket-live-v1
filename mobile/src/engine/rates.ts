/**
 * Round half away from zero to 2 decimal places.
 * `10 * 6 / 11` is `5.45`. A whole number stays a whole number (`6`, not `6.0`).
 */
export function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  if (denominator === 0) {
    throw new Error("division_by_zero");
  }
  const negative = numerator < 0 !== denominator < 0;
  const scaled = BigInt(Math.abs(numerator)) * 100n;
  const divisor = BigInt(Math.abs(denominator));
  const quotient = scaled / divisor;
  const remainder = scaled % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const hundredths = Number(rounded);
  const magnitude = hundredths / 100;
  return negative ? -magnitude : magnitude;
}
