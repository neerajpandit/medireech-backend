import { HTTP_STATUS } from '../../constants/index.js';
import { USER_ROLES } from '../../constants/database.enums.js';
import { hasPermission } from '../../constants/rbac.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { fetchNearbyMedicineAvailability } from '../../utils/fetchNearbyMedicineAvailability.js';
import {
  buildAdvancedMedicineFilter,
  buildAutocompleteFilter,
  buildMedicineSort,
  sanitizeCatalogueSearchQuery,
  toAutocompleteSuggestion,
  toCompactMedicine,
} from '../../utils/medicineSearch.js';
import { Inventory } from '../inventory/inventory.model.js';
import { Medicine } from './medicine.model.js';

const toPublicMedicine = (medicine) => ({
  id: medicine._id,
  name: medicine.name,
  genericName: medicine.genericName,
  brandName: medicine.brandName,
  manufacturer: medicine.manufacturer,
  composition: medicine.composition,
  strength: medicine.strength,
  dosageForm: medicine.dosageForm,
  packSize: medicine.packSize,
  unit: medicine.unit,
  medicineCategory: medicine.medicineCategory,
  prescriptionType: medicine.prescriptionType,
  description: medicine.description,
  image: medicine.image,
  isActive: medicine.isActive,
  createdAt: medicine.createdAt,
  updatedAt: medicine.updatedAt,
});

const buildMedicineFilter = (query, { publicOnly = false } = {}) => {
  const filter = {};

  if (publicOnly || !query.includeInactive) {
    filter.isActive = true;
  } else if (query.includeInactive === false) {
    filter.isActive = true;
  }

  if (query.genericName) {
    filter.genericName = new RegExp(query.genericName.trim(), 'i');
  }

  if (query.brandName) {
    filter.brandName = new RegExp(query.brandName.trim(), 'i');
  }

  if (query.manufacturer) {
    filter.manufacturer = new RegExp(query.manufacturer.trim(), 'i');
  }

  if (query.dosageForm) {
    filter.dosageForm = query.dosageForm;
  }

  if (query.medicineCategory) {
    filter.medicineCategory = new RegExp(query.medicineCategory.trim(), 'i');
  }

  if (query.prescriptionType) {
    filter.prescriptionType = query.prescriptionType;
  }

  if (query.search) {
    filter.$text = { $search: query.search.trim() };
  }

  return filter;
};

const querySort = (sortBy, sortOrder, search) => {
  if (search) {
    return { score: { $meta: 'textScore' } };
  }

  return { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
};

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const assertCatalogueAdmin = (role) => {
  if (role === USER_ROLES.SUPER_ADMIN) {
    return;
  }

  if (role === USER_ROLES.OPERATIONS_ADMIN && hasPermission(role, 'medicine:catalogue:manage')) {
    return;
  }

  throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to manage the medicine catalogue');
};

export const listMedicines = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const filter = buildMedicineFilter(req.query, { publicOnly: true });
  const skip = (page - 1) * limit;
  const sort = querySort(sortBy, sortOrder, req.query.search);

  let medicineQuery = Medicine.find(filter);

  if (req.query.search) {
    medicineQuery = medicineQuery
      .select({ score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } });
  } else {
    medicineQuery = medicineQuery.sort(sort);
  }

  const [medicines, total] = await Promise.all([
    medicineQuery.skip(skip).limit(limit).lean(),
    Medicine.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { medicines: medicines.map(toPublicMedicine) },
    'Medicines fetched successfully',
    paginationMeta(page, limit, total)
  );

  res.status(response.statusCode).json(response);
};

export const listAdminMedicines = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const filter = buildMedicineFilter({ ...req.query, includeInactive: req.query.includeInactive !== false }, { publicOnly: false });
  const skip = (page - 1) * limit;
  const sort = querySort(sortBy, sortOrder, req.query.search);

  const [medicines, total] = await Promise.all([
    Medicine.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Medicine.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { medicines: medicines.map(toPublicMedicine) },
    'Medicines fetched successfully',
    paginationMeta(page, limit, total)
  );

  res.status(response.statusCode).json(response);
};

export const searchMedicines = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const { filter, freeText } = buildAdvancedMedicineFilter({
    q: req.query.q || req.query.search,
    genericName: req.query.genericName,
    brandName: req.query.brandName,
    composition: req.query.composition,
    manufacturer: req.query.manufacturer,
    dosageForm: req.query.dosageForm,
    medicineCategory: req.query.medicineCategory,
    prescriptionType: req.query.prescriptionType,
  });

  if (freeText.length > 0 && freeText.length < 2) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Search query must be at least 2 characters');
  }

  const hasTextSearch = Boolean(filter.$text);
  const effectiveSortBy = sortBy === 'relevance' && !hasTextSearch ? 'createdAt' : sortBy;
  const sort = buildMedicineSort({
    sortBy: effectiveSortBy === 'relevance' ? 'createdAt' : effectiveSortBy,
    sortOrder,
    hasTextSearch: sortBy === 'relevance' && hasTextSearch,
  });

  const skip = (page - 1) * limit;
  let medicineQuery = Medicine.find(filter);

  if (sortBy === 'relevance' && hasTextSearch) {
    medicineQuery = medicineQuery
      .select({ score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } });
  } else {
    medicineQuery = medicineQuery.sort(sort);
  }

  const [medicines, total] = await Promise.all([
    medicineQuery.skip(skip).limit(limit).lean(),
    Medicine.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { medicines: medicines.map(toPublicMedicine) },
    'Medicines search completed successfully',
    paginationMeta(page, limit, total)
  );

  res.status(response.statusCode).json(response);
};

export const autocompleteMedicines = async (req, res) => {
  const filter = buildAutocompleteFilter(req.query.q);
  const limit = req.query.limit;

  const medicineQuery = Medicine.find(filter)
    .select('name genericName brandName strength dosageForm manufacturer')
    .sort({ name: 1 })
    .limit(limit)
    .lean();

  const medicines = await medicineQuery;
  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { suggestions: medicines.map(toAutocompleteSuggestion) },
    'Medicine autocomplete suggestions fetched successfully'
  );

  res.status(response.statusCode).json(response);
};

export const getMedicineAvailability = async (req, res) => {
  const medicine = await Medicine.findOne({ _id: req.params.medicineId, isActive: true }).lean();

  if (!medicine) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Medicine not found');
  }

  const radiusKm = req.query.radiusKm ?? req.query.radius;
  const { latitude, longitude, page, limit, sortBy, minPrice, maxPrice, availableOnly } = req.query;

  const { items, meta } = await fetchNearbyMedicineAvailability({
    medicine,
    longitude,
    latitude,
    radiusKm,
    page,
    limit,
    sortBy,
    filters: { minPrice, maxPrice, availableOnly },
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      medicine: toCompactMedicine(medicine),
      pharmacies: items,
    },
    'Medicine availability fetched successfully',
    meta
  );

  res.status(response.statusCode).json(response);
};

export const getMedicineById = async (req, res) => {
  const medicine = await Medicine.findById(req.params.medicineId).lean();

  if (!medicine || !medicine.isActive) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Medicine not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { medicine: toPublicMedicine(medicine) },
    'Medicine fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const createMedicine = async (req, res) => {
  assertCatalogueAdmin(req.auth.role);

  const medicine = await Medicine.create(req.body);
  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { medicine: toPublicMedicine(medicine) },
    'Medicine created successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateMedicine = async (req, res) => {
  assertCatalogueAdmin(req.auth.role);

  const medicine = await Medicine.findByIdAndUpdate(req.params.medicineId, req.body, {
    new: true,
    runValidators: true,
  });

  if (!medicine) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Medicine not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { medicine: toPublicMedicine(medicine) },
    'Medicine updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateMedicineStatus = async (req, res) => {
  assertCatalogueAdmin(req.auth.role);

  const medicine = await Medicine.findByIdAndUpdate(
    req.params.medicineId,
    { isActive: req.body.isActive },
    { new: true, runValidators: true }
  );

  if (!medicine) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Medicine not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { medicine: toPublicMedicine(medicine) },
    'Medicine status updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const deleteMedicine = async (req, res) => {
  assertCatalogueAdmin(req.auth.role);

  const medicine = await Medicine.findById(req.params.medicineId);

  if (!medicine) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Medicine not found');
  }

  const inventoryReferences = await Inventory.countDocuments({ medicine: medicine._id });

  if (inventoryReferences > 0) {
    medicine.isActive = false;
    await medicine.save();

    const response = new ApiResponse(
      HTTP_STATUS.OK,
      { medicine: toPublicMedicine(medicine) },
      'Medicine deactivated because it is referenced by inventory records'
    );
    res.status(response.statusCode).json(response);
    return;
  }

  await medicine.deleteOne();

  const response = new ApiResponse(HTTP_STATUS.OK, null, 'Medicine deleted successfully');
  res.status(response.statusCode).json(response);
};
