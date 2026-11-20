import { getBatchSellableQuantity } from './inventoryStock.js';

/**
 * First-expiry-first-out allocation plan (no database writes).
 */
export const planFefoBatchAllocations = (batches, quantityNeeded, now = new Date()) => {
  const eligible = (batches || [])
    .map((batch) => ({
      batch,
      sellable: getBatchSellableQuantity(batch, now),
    }))
    .filter((entry) => entry.sellable > 0)
    .sort(
      (left, right) => new Date(left.batch.expiryDate).getTime() - new Date(right.batch.expiryDate).getTime()
    );

  let remaining = quantityNeeded;
  const allocations = [];

  for (const { batch, sellable } of eligible) {
    if (remaining <= 0) {
      break;
    }

    const quantity = Math.min(remaining, sellable);
    allocations.push({
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      quantity,
      unitPrice: batch.unitPrice,
    });
    remaining -= quantity;
  }

  if (remaining > 0) {
    return null;
  }

  return allocations;
};

export const calculateWeightedUnitPrice = (allocations) => {
  if (!allocations?.length) {
    return null;
  }

  const totalQty = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  const totalValue = allocations.reduce(
    (sum, allocation) => sum + allocation.quantity * allocation.unitPrice,
    0
  );

  return Number((totalValue / totalQty).toFixed(2));
};
