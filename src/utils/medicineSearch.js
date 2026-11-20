/**
 * Catalogue search helpers (pure + query builders).
 * Uses MongoDB text search on Medicine when q length >= 3; otherwise prefix matching on indexed string fields.
 * MongoDB Atlas Search is NOT required; standard text index `medicine_search_text` is used in development and Atlas.
 */

export const sanitizeCatalogueSearchQuery = (value) =>
  String(value || '')
    .trim()
    .replace(/[^\w\s+\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);

export const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildAutocompleteFilter = (query) => {
  const sanitized = sanitizeCatalogueSearchQuery(query);

  return {
    isActive: true,
    ...buildPrefixOrFilter(sanitized),
  };
};

export const buildPrefixOrFilter = (query) => {
  const prefix = escapeRegExp(query);
  const pattern = new RegExp(`^${prefix}`, 'i');

  return {
    $or: [
      { name: pattern },
      { genericName: pattern },
      { brandName: pattern },
      { composition: pattern },
    ],
  };
};

export const buildAdvancedMedicineFilter = (query) => {
  const filter = { isActive: true };

  if (query.genericName) {
    filter.genericName = new RegExp(escapeRegExp(query.genericName.trim()), 'i');
  }

  if (query.brandName) {
    filter.brandName = new RegExp(escapeRegExp(query.brandName.trim()), 'i');
  }

  if (query.composition) {
    filter.composition = new RegExp(escapeRegExp(query.composition.trim()), 'i');
  }

  if (query.manufacturer) {
    filter.manufacturer = new RegExp(escapeRegExp(query.manufacturer.trim()), 'i');
  }

  if (query.dosageForm) {
    filter.dosageForm = query.dosageForm;
  }

  if (query.medicineCategory) {
    filter.medicineCategory = new RegExp(escapeRegExp(query.medicineCategory.trim()), 'i');
  }

  if (query.prescriptionType) {
    filter.prescriptionType = query.prescriptionType;
  }

  const freeText = sanitizeCatalogueSearchQuery(query.q || query.search);

  if (freeText.length >= 3) {
    filter.$text = { $search: freeText };
  } else if (freeText.length >= 2) {
    Object.assign(filter, buildPrefixOrFilter(freeText));
  }

  return { filter, freeText };
};

export const buildMedicineSort = ({ sortBy, sortOrder, hasTextSearch }) => {
  if (hasTextSearch) {
    return { score: { $meta: 'textScore' } };
  }

  const direction = sortOrder === 'asc' ? 1 : -1;
  return { [sortBy]: direction };
};

export const toAutocompleteSuggestion = (medicine) => ({
  medicineId: medicine._id,
  name: medicine.name,
  genericName: medicine.genericName,
  brandName: medicine.brandName,
  strength: medicine.strength,
  dosageForm: medicine.dosageForm,
  manufacturer: medicine.manufacturer,
});

export const toCompactMedicine = (medicine) => ({
  id: medicine._id,
  name: medicine.name,
  genericName: medicine.genericName,
  brandName: medicine.brandName,
  strength: medicine.strength,
  dosageForm: medicine.dosageForm,
  prescriptionType: medicine.prescriptionType,
  manufacturer: medicine.manufacturer,
  composition: medicine.composition,
});
