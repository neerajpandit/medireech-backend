import {
  PHARMACY_OPERATIONAL_STATUS,
  PHARMACY_VERIFICATION_STATUS,
} from '../constants/database.enums.js';
import { Inventory } from '../modules/inventory/inventory.model.js';
import { Medicine } from '../modules/medicines/medicine.model.js';
import { Pharmacy } from '../modules/pharmacies/pharmacy.model.js';
import { buildAdvancedMedicineFilter, sanitizeCatalogueSearchQuery } from './medicineSearch.js';
import {
  applyPharmacyDiscoveryFilters,
  buildPharmacyDiscoveryRow,
  paginateRows,
  sortPharmacyDiscoveryRows,
  toPublicPharmacyAddress,
} from './nearbyDiscovery.js';

export const resolveActiveMedicineForDiscovery = async ({ medicineId, q, search, dosageForm }) => {
  if (medicineId) {
    const filter = { _id: medicineId, isActive: true };
    if (dosageForm) {
      filter.dosageForm = dosageForm;
    }

    return Medicine.findOne(filter).lean();
  }

  const term = sanitizeCatalogueSearchQuery(q || search);
  if (!term) {
    return null;
  }

  const { filter } = buildAdvancedMedicineFilter({ q: term, dosageForm });

  if (filter.$text) {
    return Medicine.findOne(filter)
      .select({ score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .lean();
  }

  return Medicine.findOne(filter).lean();
};

export const operationalPharmacyQuery = {
  verificationStatus: PHARMACY_VERIFICATION_STATUS.APPROVED,
  operationalStatus: PHARMACY_OPERATIONAL_STATUS.ACTIVE,
};

const mapNearbyPharmacyRow = (pharmacy) => ({
  pharmacyId: pharmacy._id.toString(),
  pharmacyName: pharmacy.pharmacyName,
  address: toPublicPharmacyAddress(pharmacy.address),
  phone: pharmacy.phone,
  location: {
    latitude: pharmacy.location.coordinates[1],
    longitude: pharmacy.location.coordinates[0],
  },
  openingHours: pharmacy.openingHours || [],
  acceptsReservations: pharmacy.acceptsReservations !== false,
  operationalStatus: pharmacy.operationalStatus,
  verificationStatus: pharmacy.verificationStatus,
  distanceKm: Number((pharmacy.distanceMeters / 1000).toFixed(2)),
});

export const fetchNearbyPharmacies = async ({
  longitude,
  latitude,
  radiusKm,
  page,
  limit,
  sortBy = 'distance',
}) => {
  const pharmacies = await Pharmacy.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: operationalPharmacyQuery,
      },
    },
    {
      $project: {
        pharmacyName: 1,
        address: 1,
        phone: 1,
        location: 1,
        openingHours: 1,
        acceptsReservations: 1,
        operationalStatus: 1,
        verificationStatus: 1,
        distanceMeters: 1,
      },
    },
  ]);

  const rows = pharmacies.map(mapNearbyPharmacyRow);

  if (sortBy === 'name') {
    rows.sort(
      (left, right) =>
        left.pharmacyName.localeCompare(right.pharmacyName) || left.pharmacyId.localeCompare(right.pharmacyId)
    );
  } else {
    rows.sort(
      (left, right) => left.distanceKm - right.distanceKm || left.pharmacyId.localeCompare(right.pharmacyId)
    );
  }

  return paginateRows(rows, page, limit);
};

/**
 * Geospatial discovery pipeline:
 * 1. $geoNear on approved + active pharmacies (uses 2dsphere index on location)
 * 2. Single inventory query for medicine + pharmacy ids (no per-pharmacy N+1)
 */
export const fetchNearbyMedicineAvailability = async ({
  medicine,
  longitude,
  latitude,
  radiusKm,
  page,
  limit,
  sortBy,
  filters = {},
  now = new Date(),
}) => {
  const pharmacies = await Pharmacy.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: operationalPharmacyQuery,
      },
    },
    {
      $project: {
        pharmacyName: 1,
        address: 1,
        openingHours: 1,
        distanceMeters: 1,
      },
    },
  ]);

  if (pharmacies.length === 0) {
    return paginateRows([], page, limit);
  }

  const pharmacyIds = pharmacies.map((pharmacy) => pharmacy._id);
  const inventories = await Inventory.find({
    pharmacy: { $in: pharmacyIds },
    medicine: medicine._id,
    isActive: true,
  })
    .select('pharmacy batches isActive')
    .lean();

  const inventoryByPharmacy = new Map(inventories.map((item) => [item.pharmacy.toString(), item]));

  const rows = [];

  for (const pharmacy of pharmacies) {
    const inventory = inventoryByPharmacy.get(pharmacy._id.toString());
    if (!inventory) {
      continue;
    }

    const row = buildPharmacyDiscoveryRow(pharmacy, inventory, pharmacy.distanceMeters, now);
    if (row) {
      rows.push(row);
    }
  }

  const filtered = applyPharmacyDiscoveryFilters(rows, {
    ...filters,
    medicineDosageForm: medicine.dosageForm,
  });

  const sorted = sortPharmacyDiscoveryRows(filtered, sortBy);
  return paginateRows(sorted, page, limit);
};
