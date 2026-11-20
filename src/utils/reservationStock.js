import mongoose from 'mongoose';
import { Inventory } from '../modules/inventory/inventory.model.js';
import { getBatchSellableQuantity } from './inventoryStock.js';
import { applySession, sessionOption } from './transactionRetry.js';

const findBatch = (inventory, batchId) => inventory?.batches?.id(batchId);

/**
 * Transaction-scoped stock mutations with conditional checks.
 * Used inside MongoDB multi-document transactions (replica set / Atlas).
 */
export const atomicallyIncreaseBatchReserved = async ({
  inventoryId,
  batchId,
  quantity,
  session,
}) => {
  const inventory = await applySession(Inventory.findOne({ _id: inventoryId }), session);
  const batch = findBatch(inventory, batchId);

  if (!batch?.isActive || getBatchSellableQuantity(batch) < quantity) {
    return false;
  }

  batch.reservedQuantity += quantity;
  inventory.lastStockUpdatedAt = new Date();
  await inventory.save(sessionOption(session));
  return true;
};

export const atomicallyDecreaseBatchReserved = async ({
  inventoryId,
  batchId,
  quantity,
  session,
}) => {
  const inventory = await applySession(Inventory.findOne({ _id: inventoryId }), session);
  const batch = findBatch(inventory, batchId);

  if (!batch || batch.reservedQuantity < quantity) {
    return false;
  }

  batch.reservedQuantity -= quantity;
  inventory.lastStockUpdatedAt = new Date();
  await inventory.save(sessionOption(session));
  return true;
};

export const atomicallyCollectBatchStock = async ({
  inventoryId,
  batchId,
  quantity,
  session,
}) => {
  const inventory = await applySession(Inventory.findOne({ _id: inventoryId }), session);
  const batch = findBatch(inventory, batchId);

  if (!batch || batch.physicalQuantity < quantity || batch.reservedQuantity < quantity) {
    return false;
  }

  batch.physicalQuantity -= quantity;
  batch.reservedQuantity -= quantity;
  inventory.lastStockUpdatedAt = new Date();
  await inventory.save(sessionOption(session));
  return true;
};

export const toBatchObjectId = (batchId) =>
  batchId instanceof mongoose.Types.ObjectId ? batchId : new mongoose.Types.ObjectId(batchId);
