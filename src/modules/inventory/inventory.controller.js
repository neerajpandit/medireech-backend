import mongoose from 'mongoose';
import { HTTP_STATUS } from '../../constants/index.js';
import { STOCK_ADJUSTMENT_TYPES, STOCK_MOVEMENT_TYPES } from '../../constants/inventory.constants.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import {
  computeInventorySellableQuantity,
  isBatchNearExpiry,
} from '../../utils/inventoryStock.js';
import {
  fetchNearbyMedicineAvailability,
  resolveActiveMedicineForDiscovery,
} from '../../utils/fetchNearbyMedicineAvailability.js';
import { toCompactMedicine } from '../../utils/medicineSearch.js';
import { applySession, runWithTransactionRetry, sessionOption } from '../../utils/transactionRetry.js';
import { Medicine } from '../medicines/medicine.model.js';
import { Inventory } from './inventory.model.js';
import { StockMovement } from './stockMovement.model.js';

const toBatchResponse = (batch, { includePurchasePrice = false } = {}) => {
  const payload = {
    id: batch._id,
    batchNumber: batch.batchNumber,
    manufacturingDate: batch.manufacturingDate,
    expiryDate: batch.expiryDate,
    physicalQuantity: batch.physicalQuantity,
    reservedQuantity: batch.reservedQuantity,
    availableQuantity: Math.max(batch.physicalQuantity - batch.reservedQuantity, 0),
    unitPrice: batch.unitPrice,
    mrp: batch.mrp,
    isActive: batch.isActive,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };

  if (includePurchasePrice && batch.purchasePrice != null) {
    payload.purchasePrice = batch.purchasePrice;
  }

  return payload;
};

const toInventoryResponse = (inventory, medicine, options = {}) => {
  const now = options.now || new Date();
  const sellableQuantity = computeInventorySellableQuantity(inventory, now);

  return {
    id: inventory._id,
    pharmacy: inventory.pharmacy,
    medicine: medicine
      ? {
          id: medicine._id,
          name: medicine.name,
          genericName: medicine.genericName,
          brandName: medicine.brandName,
          dosageForm: medicine.dosageForm,
          strength: medicine.strength,
          prescriptionType: medicine.prescriptionType,
        }
      : inventory.medicine,
    batches: (inventory.batches || []).map((batch) =>
      toBatchResponse(batch, { includePurchasePrice: options.includePurchasePrice })
    ),
    sellableQuantity,
    isAvailable: sellableQuantity > 0 && inventory.isActive !== false,
    isActive: inventory.isActive,
    lastStockUpdatedAt: inventory.lastStockUpdatedAt,
    createdAt: inventory.createdAt,
    updatedAt: inventory.updatedAt,
  };
};

const getInventoryForPharmacy = async (inventoryId, pharmacyId) => {
  const inventory = await Inventory.findOne({ _id: inventoryId, pharmacy: pharmacyId }).populate('medicine');

  if (!inventory) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Inventory record not found');
  }

  return inventory;
};

export const addInventory = async (req, res) => {
  const { medicineId, batch } = req.body;
  const pharmacyId = req.pharmacyId;

  const medicine = await Medicine.findOne({ _id: medicineId, isActive: true }).lean();
  if (!medicine) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Active medicine not found in catalogue');
  }

  const normalizedBatchNumber = batch.batchNumber.trim().toUpperCase();
  const inventory = await runWithTransactionRetry(async (session) => {
    let inventory = await applySession(
      Inventory.findOne({ pharmacy: pharmacyId, medicine: medicineId }),
      session
    );

    if (!inventory) {
      [inventory] = await Inventory.create(
        [
          {
            pharmacy: pharmacyId,
            medicine: medicineId,
            batches: [],
            isActive: true,
          },
        ],
        sessionOption(session)
      );
    }

    const duplicateBatch = inventory.batches.some(
      (existingBatch) => existingBatch.batchNumber === normalizedBatchNumber
    );

    if (duplicateBatch) {
      throw new ApiError(HTTP_STATUS.CONFLICT, 'Batch number already exists for this inventory item');
    }

    inventory.batches.push({
      batchNumber: normalizedBatchNumber,
      manufacturingDate: batch.manufacturingDate ? new Date(batch.manufacturingDate) : undefined,
      expiryDate: new Date(batch.expiryDate),
      physicalQuantity: batch.physicalQuantity,
      reservedQuantity: 0,
      unitPrice: batch.unitPrice,
      mrp: batch.mrp,
      purchasePrice: batch.purchasePrice,
      isActive: true,
    });

    inventory.lastStockUpdatedAt = new Date();
    await inventory.save(sessionOption(session));

    const createdBatch = inventory.batches[inventory.batches.length - 1];

    await StockMovement.create(
      [
        {
          pharmacy: pharmacyId,
          inventory: inventory._id,
          medicine: medicineId,
          batchId: createdBatch._id,
          batchNumber: createdBatch.batchNumber,
          movementType: STOCK_MOVEMENT_TYPES.STOCK_ADDED,
          quantity: batch.physicalQuantity,
          previousPhysicalQuantity: 0,
          newPhysicalQuantity: batch.physicalQuantity,
          previousReservedQuantity: 0,
          newReservedQuantity: 0,
          reason: 'Initial batch added to inventory',
          performedBy: req.auth.userId,
        },
      ],
      sessionOption(session)
    );

    return inventory;
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    {
      inventory: toInventoryResponse(inventory, medicine, {
        includePurchasePrice: req.canViewPurchasePrice,
      }),
    },
    'Inventory updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const listMyStockMovements = async (req, res) => {
  const { page, limit, inventoryId } = req.query;
  const filter = { pharmacy: req.pharmacyId };
  if (inventoryId) filter.inventory = inventoryId;

  const [rows, total] = await Promise.all([
    StockMovement.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StockMovement.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      movements: rows.map((row) => ({
        id: row._id,
        inventory: row.inventory,
        medicine: row.medicine,
        batchId: row.batchId,
        batchNumber: row.batchNumber,
        movementType: row.movementType,
        quantity: row.quantity,
        previousPhysicalQuantity: row.previousPhysicalQuantity,
        newPhysicalQuantity: row.newPhysicalQuantity,
        previousReservedQuantity: row.previousReservedQuantity,
        newReservedQuantity: row.newReservedQuantity,
        reason: row.reason,
        performedBy: row.performedBy,
        createdAt: row.createdAt,
      })),
    },
    'Stock movements fetched successfully',
    {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    }
  );
  res.status(response.statusCode).json(response);
};

export const listMyPharmacyInventory = async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const now = new Date();
  const skip = (page - 1) * limit;

  const inventories = await Inventory.find({ pharmacy: req.pharmacyId })
    .populate('medicine')
    .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
    .lean();

  const filtered = inventories.filter((inventory) => {
    const medicine = inventory.medicine;
    if (!medicine) {
      return false;
    }

    if (req.query.dosageForm && medicine.dosageForm !== req.query.dosageForm) {
      return false;
    }

    if (req.query.search) {
      const term = req.query.search.toLowerCase();
      const haystack = [medicine.name, medicine.genericName, medicine.brandName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) {
        return false;
      }
    }

    const sellableQuantity = computeInventorySellableQuantity(inventory, now);

    if (req.query.availableOnly && sellableQuantity <= 0) {
      return false;
    }

    if (req.query.outOfStock && sellableQuantity > 0) {
      return false;
    }

    if (req.query.lowStock && sellableQuantity > env.inventoryLowStockThreshold) {
      return false;
    }

    if (req.query.nearExpiry) {
      const hasNearExpiry = (inventory.batches || []).some((batch) =>
        isBatchNearExpiry(new Date(batch.expiryDate), env.inventoryNearExpiryDays, now)
      );
      if (!hasNearExpiry) {
        return false;
      }
    }

    return true;
  });

  const paginated = filtered.slice(skip, skip + limit).map((inventory) =>
    toInventoryResponse(inventory, inventory.medicine, {
      includePurchasePrice: req.canViewPurchasePrice,
      now,
    })
  );

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { inventory: paginated },
    'Pharmacy inventory fetched successfully',
    {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / limit) || 1,
    }
  );

  res.status(response.statusCode).json(response);
};

export const getInventoryById = async (req, res) => {
  const inventory = await getInventoryForPharmacy(req.params.inventoryId, req.pharmacyId);

  if (inventory.pharmacy.toString() !== req.pharmacyId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You cannot access another pharmacy inventory');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      inventory: toInventoryResponse(inventory, inventory.medicine, {
        includePurchasePrice: req.canViewPurchasePrice,
      }),
    },
    'Inventory fetched successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateInventoryBatch = async (req, res) => {
  const inventory = await Inventory.findOne({
    _id: req.params.inventoryId,
    pharmacy: req.pharmacyId,
  }).select('+batches.purchasePrice');

  if (!inventory) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Inventory record not found');
  }

  const batch = inventory.batches.id(req.params.batchId);
  if (!batch) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Batch not found');
  }

  if (req.body.expiryDate) {
    batch.expiryDate = new Date(req.body.expiryDate);
  }

  if (req.body.unitPrice != null) {
    batch.unitPrice = req.body.unitPrice;
  }

  if (req.body.mrp != null) {
    batch.mrp = req.body.mrp;
  }

  if (req.body.purchasePrice != null && req.canViewPurchasePrice) {
    batch.purchasePrice = req.body.purchasePrice;
  }

  if (req.body.isActive != null) {
    batch.isActive = req.body.isActive;
  }

  if (batch.unitPrice > batch.mrp) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Unit price cannot exceed MRP');
  }

  if (batch.manufacturingDate && batch.manufacturingDate > batch.expiryDate) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Expiry date must be after manufacturing date');
  }

  inventory.lastStockUpdatedAt = new Date();
  await inventory.save();

  await inventory.populate('medicine');

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      inventory: toInventoryResponse(inventory, inventory.medicine, {
        includePurchasePrice: req.canViewPurchasePrice,
      }),
    },
    'Inventory batch updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const adjustInventoryStock = async (req, res) => {
  const { adjustmentType, quantity, reason } = req.body;
  const { inventoryId, batchId } = req.params;

  let delta = 0;
  if (adjustmentType === STOCK_ADJUSTMENT_TYPES.ADD) {
    delta = quantity;
  } else if (adjustmentType === STOCK_ADJUSTMENT_TYPES.REMOVE) {
    delta = -quantity;
  } else {
    const inventorySnapshot = await Inventory.findOne({ _id: inventoryId, pharmacy: req.pharmacyId });
    const batchSnapshot = inventorySnapshot?.batches.id(batchId);
    if (!batchSnapshot) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Batch not found');
    }
    delta = quantity - batchSnapshot.physicalQuantity;
  }

  const minPhysical =
    adjustmentType === STOCK_ADJUSTMENT_TYPES.REMOVE
      ? quantity
      : adjustmentType === STOCK_ADJUSTMENT_TYPES.CORRECTION
        ? Math.max(0, quantity)
        : 0;

  const filter =
    adjustmentType === STOCK_ADJUSTMENT_TYPES.REMOVE
      ? {
          _id: inventoryId,
          pharmacy: req.pharmacyId,
          batches: {
            $elemMatch: {
              _id: new mongoose.Types.ObjectId(batchId),
              physicalQuantity: { $gte: minPhysical },
            },
          },
        }
      : {
          _id: inventoryId,
          pharmacy: req.pharmacyId,
          'batches._id': batchId,
        };

  const updatedInventory = await Inventory.findOneAndUpdate(
    filter,
    {
      $inc: { 'batches.$.physicalQuantity': delta },
      $set: { lastStockUpdatedAt: new Date() },
    },
    { new: true }
  ).populate('medicine');

  if (!updatedInventory) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      'Stock adjustment failed because available stock is insufficient or batch was modified concurrently'
    );
  }

  const updatedBatch = updatedInventory.batches.id(batchId);

  if (updatedBatch.physicalQuantity < updatedBatch.reservedQuantity) {
    await Inventory.findOneAndUpdate(
      { _id: inventoryId, pharmacy: req.pharmacyId, 'batches._id': batchId },
      { $inc: { 'batches.$.physicalQuantity': -delta } }
    );
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Stock removal would reduce physical stock below reserved quantity');
  }

  const movementType =
    delta >= 0 ? STOCK_MOVEMENT_TYPES.STOCK_ADDED : STOCK_MOVEMENT_TYPES.STOCK_REMOVED;

  await StockMovement.create({
    pharmacy: req.pharmacyId,
    inventory: updatedInventory._id,
    medicine: updatedInventory.medicine._id,
    batchId: updatedBatch._id,
    batchNumber: updatedBatch.batchNumber,
    movementType: adjustmentType === STOCK_ADJUSTMENT_TYPES.CORRECTION ? STOCK_MOVEMENT_TYPES.STOCK_ADJUSTED : movementType,
    quantity: Math.abs(delta),
    previousPhysicalQuantity: updatedBatch.physicalQuantity - delta,
    newPhysicalQuantity: updatedBatch.physicalQuantity,
    previousReservedQuantity: updatedBatch.reservedQuantity,
    newReservedQuantity: updatedBatch.reservedQuantity,
    reason,
    performedBy: req.auth.userId,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      inventory: toInventoryResponse(updatedInventory, updatedInventory.medicine, {
        includePurchasePrice: req.canViewPurchasePrice,
      }),
    },
    'Stock adjusted successfully'
  );
  res.status(response.statusCode).json(response);
};

export const updateInventoryStatus = async (req, res) => {
  const inventory = await Inventory.findOneAndUpdate(
    { _id: req.params.inventoryId, pharmacy: req.pharmacyId },
    { isActive: req.body.isActive, lastStockUpdatedAt: new Date() },
    { new: true }
  ).populate('medicine');

  if (!inventory) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Inventory record not found');
  }

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      inventory: toInventoryResponse(inventory, inventory.medicine, {
        includePurchasePrice: req.canViewPurchasePrice,
      }),
    },
    'Inventory status updated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const deleteInventoryBatch = async (req, res) => {
  const inventory = await Inventory.findOne({
    _id: req.params.inventoryId,
    pharmacy: req.pharmacyId,
  });

  if (!inventory) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Inventory record not found');
  }

  const batch = inventory.batches.id(req.params.batchId);
  if (!batch) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Batch not found');
  }

  if (batch.reservedQuantity > 0) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Batch cannot be deleted while reserved quantity exists');
  }

  batch.isActive = false;
  inventory.lastStockUpdatedAt = new Date();
  await inventory.save();
  await inventory.populate('medicine');

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      inventory: toInventoryResponse(inventory, inventory.medicine, {
        includePurchasePrice: req.canViewPurchasePrice,
      }),
    },
    'Inventory batch deactivated successfully'
  );
  res.status(response.statusCode).json(response);
};

export const searchNearbyInventory = async (req, res) => {
  const radiusKm = req.query.radiusKm ?? req.query.radius;
  const { latitude, longitude, page, limit, sortBy, minPrice, maxPrice, dosageForm, availableOnly } =
    req.query;
  const now = new Date();

  const medicine = await resolveActiveMedicineForDiscovery({
    medicineId: req.query.medicineId,
    q: req.query.q,
    search: req.query.search,
    dosageForm,
  });

  if (!medicine) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Active medicine not found');
  }

  const { items, meta } = await fetchNearbyMedicineAvailability({
    medicine,
    longitude,
    latitude,
    radiusKm,
    page,
    limit,
    sortBy,
    filters: { minPrice, maxPrice, availableOnly },
    now,
  });

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    {
      medicine: toCompactMedicine(medicine),
      pharmacies: items,
    },
    'Nearby medicine availability fetched successfully',
    meta
  );

  res.status(response.statusCode).json(response);
};
