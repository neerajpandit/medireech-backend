/**
 * Monetary helpers — all internal payment amounts use integer paise (1 INR = 100 paise).
 */

export const rupeesToPaise = (rupees) => Math.round(Number(rupees) * 100);

export const paiseToRupees = (paise) => Number((Number(paise) / 100).toFixed(2));

export const computeReservationTotalPaise = (reservation) => {
  let totalPaise = 0;

  for (const item of reservation.items || []) {
    const unitPrice = item.acceptedUnitPrice ?? item.unitPrice;
    if (unitPrice == null || item.quantity == null) {
      continue;
    }

    const linePaise = Math.round(Number(unitPrice) * Number(item.quantity) * 100);
    totalPaise += linePaise;
  }

  return totalPaise;
};
