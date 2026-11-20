import { isBatchExpired } from './schemaValidators.js';

/**
 * availableQuantity (sellable) = physicalQuantity - reservedQuantity
 */
export const getBatchSellableQuantity = (batch, now = new Date()) => {
  if (!batch?.isActive || isBatchExpired(batch.expiryDate, now)) {
    return 0;
  }

  return Math.max(Number(batch.physicalQuantity || 0) - Number(batch.reservedQuantity || 0), 0);
};

export const computeInventorySellableQuantity = (inventory, now = new Date()) => {
  const batches = inventory?.batches || [];

  return batches.reduce((total, batch) => total + getBatchSellableQuantity(batch, now), 0);
};

export const isBatchNearExpiry = (expiryDate, windowDays, now = new Date()) => {
  if (!(expiryDate instanceof Date)) {
    return false;
  }

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  return expiryDate.getTime() > now.getTime() && expiryDate.getTime() <= now.getTime() + windowMs;
};

export const getLowestActiveBatchPrice = (inventory, now = new Date()) => {
  let lowestUnitPrice = null;

  for (const batch of inventory?.batches || []) {
    if (!batch.isActive || isBatchExpired(batch.expiryDate, now)) {
      continue;
    }

    if (getBatchSellableQuantity(batch, now) <= 0) {
      continue;
    }

    if (lowestUnitPrice == null || batch.unitPrice < lowestUnitPrice) {
      lowestUnitPrice = batch.unitPrice;
    }
  }

  return lowestUnitPrice;
};

export const getLowestActiveBatchMrp = (inventory, now = new Date()) => {
  let lowestMrp = null;

  for (const batch of inventory?.batches || []) {
    if (!batch.isActive || isBatchExpired(batch.expiryDate, now)) {
      continue;
    }

    if (getBatchSellableQuantity(batch, now) <= 0) {
      continue;
    }

    if (lowestMrp == null || batch.mrp < lowestMrp) {
      lowestMrp = batch.mrp;
    }
  }

  return lowestMrp;
};
