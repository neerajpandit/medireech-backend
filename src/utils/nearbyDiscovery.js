import {
  computeInventorySellableQuantity,
  getBatchSellableQuantity,
} from './inventoryStock.js';
import { isBatchExpired } from './schemaValidators.js';

/**
 * Recommended ranking (deterministic, documented):
 * 1. Higher sellable availability first
 * 2. Shorter distance first
 * 3. Lower lowestUnitPrice first
 * 4. Stable tie-breaker: pharmacyId ascending
 */
export const sortPharmacyDiscoveryRows = (rows, sortBy) => {
  const sorted = [...rows];

  sorted.sort((left, right) => {
    if (sortBy === 'price') {
      const priceDiff = (left.lowestUnitPrice ?? Number.POSITIVE_INFINITY) - (right.lowestUnitPrice ?? Number.POSITIVE_INFINITY);
      if (priceDiff !== 0) {
        return priceDiff;
      }
      return left.distanceKm - right.distanceKm || left.pharmacyId.localeCompare(right.pharmacyId);
    }

    if (sortBy === 'availability') {
      const qtyDiff = right.availableQuantity - left.availableQuantity;
      if (qtyDiff !== 0) {
        return qtyDiff;
      }
      return left.distanceKm - right.distanceKm || left.pharmacyId.localeCompare(right.pharmacyId);
    }

    if (sortBy === 'recommended') {
      const availabilityDiff = right.availableQuantity - left.availableQuantity;
      if (availabilityDiff !== 0) {
        return availabilityDiff;
      }

      const distanceDiff = left.distanceKm - right.distanceKm;
      if (distanceDiff !== 0) {
        return distanceDiff;
      }

      const priceDiff =
        (left.lowestUnitPrice ?? Number.POSITIVE_INFINITY) - (right.lowestUnitPrice ?? Number.POSITIVE_INFINITY);
      if (priceDiff !== 0) {
        return priceDiff;
      }

      return left.pharmacyId.localeCompare(right.pharmacyId);
    }

    const distanceDiff = left.distanceKm - right.distanceKm;
    if (distanceDiff !== 0) {
      return distanceDiff;
    }

    return left.pharmacyId.localeCompare(right.pharmacyId);
  });

  return sorted;
};

export const summarizePharmacyInventory = (inventory, now = new Date()) => {
  const batches = inventory?.batches || [];
  let availableQuantity = 0;
  let lowestUnitPrice = null;
  let lowestUnitPriceQuantity = 0;
  let mrpForLowestPrice = null;

  for (const batch of batches) {
    if (!batch?.isActive || isBatchExpired(batch.expiryDate, now)) {
      continue;
    }

    const sellable = getBatchSellableQuantity(batch, now);
    if (sellable <= 0) {
      continue;
    }

    availableQuantity += sellable;

    if (lowestUnitPrice == null || batch.unitPrice < lowestUnitPrice) {
      lowestUnitPrice = batch.unitPrice;
      lowestUnitPriceQuantity = sellable;
      mrpForLowestPrice = batch.mrp;
    } else if (batch.unitPrice === lowestUnitPrice) {
      lowestUnitPriceQuantity += sellable;
    }
  }

  let discountPercentage = null;
  if (lowestUnitPrice != null && mrpForLowestPrice != null && mrpForLowestPrice > lowestUnitPrice) {
    discountPercentage = Number((((mrpForLowestPrice - lowestUnitPrice) / mrpForLowestPrice) * 100).toFixed(2));
  }

  return {
    availableQuantity,
    lowestUnitPrice,
    lowestUnitPriceQuantity,
    mrp: mrpForLowestPrice,
    discountPercentage,
    isAvailable: availableQuantity > 0,
  };
};

export const toPublicPharmacyAddress = (address) => ({
  addressLine: address?.addressLine,
  landmark: address?.landmark,
  city: address?.city,
  district: address?.district,
  state: address?.state,
  pincode: address?.pincode,
  country: address?.country,
});

export const buildPharmacyDiscoveryRow = (pharmacy, inventory, distanceMeters, now = new Date()) => {
  const summary = summarizePharmacyInventory(inventory, now);

  if (!summary.isAvailable) {
    return null;
  }

  return {
    pharmacyId: pharmacy._id.toString(),
    pharmacyName: pharmacy.pharmacyName,
    address: toPublicPharmacyAddress(pharmacy.address),
    distanceKm: Number((distanceMeters / 1000).toFixed(2)),
    openingHours: pharmacy.openingHours || [],
    availableQuantity: summary.availableQuantity,
    lowestUnitPrice: summary.lowestUnitPrice,
    lowestUnitPriceQuantity: summary.lowestUnitPriceQuantity,
    lowestUnitPriceNote:
      summary.lowestUnitPriceQuantity < summary.availableQuantity
        ? 'Lowest unit price applies to part of the available stock only'
        : undefined,
    mrp: summary.mrp,
    discountPercentage: summary.discountPercentage,
    isAvailable: true,
  };
};

export const applyPharmacyDiscoveryFilters = (rows, filters) => {
  let filtered = rows;

  if (filters.dosageForm && filters.medicineDosageForm && filters.medicineDosageForm !== filters.dosageForm) {
    return [];
  }

  if (filters.availableOnly !== false) {
    filtered = filtered.filter((row) => row.isAvailable && row.availableQuantity > 0);
  }

  if (filters.minPrice != null) {
    filtered = filtered.filter((row) => row.lowestUnitPrice >= filters.minPrice);
  }

  if (filters.maxPrice != null) {
    filtered = filtered.filter((row) => row.lowestUnitPrice <= filters.maxPrice);
  }

  return filtered;
};

export const paginateRows = (rows, page, limit) => {
  const total = rows.length;
  const skip = (page - 1) * limit;
  const items = rows.slice(skip, skip + limit);

  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

/** Quick sanity check used in tests to ensure batch totals match utility aggregation. */
export const verifyInventorySellableMatchesSummary = (inventory, now = new Date()) => {
  const summaryQty = summarizePharmacyInventory(inventory, now).availableQuantity;
  const utilityQty = computeInventorySellableQuantity(inventory, now);
  return summaryQty === utilityQty;
};
