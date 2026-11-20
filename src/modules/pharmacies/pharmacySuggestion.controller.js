import { HTTP_STATUS } from '../../constants/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { MedicineSuggestion } from '../admin/medicineSuggestion.model.js';

const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

const toSuggestion = (row) => ({
  id: row._id,
  pharmacyId: row.pharmacy,
  submittedBy: row.submittedBy,
  name: row.name,
  genericName: row.genericName,
  strength: row.strength,
  dosageForm: row.dosageForm,
  manufacturer: row.manufacturer,
  notes: row.notes,
  status: row.status,
  reviewNote: row.reviewNote,
  reviewedAt: row.reviewedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const listMyMedicineSuggestions = async (req, res) => {
  const { page = 1, limit = 50, status } = req.query;
  const filter = { pharmacy: req.pharmacy._id };
  if (status) filter.status = status;

  const [rows, total] = await Promise.all([
    MedicineSuggestion.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    MedicineSuggestion.countDocuments(filter),
  ]);

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { suggestions: rows.map(toSuggestion) },
    'Medicine suggestions fetched successfully',
    paginationMeta(page, limit, total)
  );
  res.status(response.statusCode).json(response);
};

export const createMyMedicineSuggestion = async (req, res) => {
  const suggestion = await MedicineSuggestion.create({
    pharmacy: req.pharmacy._id,
    submittedBy: req.auth.userId,
    name: req.body.name,
    genericName: req.body.genericName,
    strength: req.body.strength,
    dosageForm: req.body.dosageForm,
    manufacturer: req.body.manufacturer,
    notes: req.body.notes,
  });

  const response = new ApiResponse(
    HTTP_STATUS.CREATED,
    { suggestion: toSuggestion(suggestion.toObject()) },
    'Medicine suggestion submitted successfully'
  );
  res.status(response.statusCode).json(response);
};

export const getMyMedicineSuggestion = async (req, res) => {
  const suggestion = await MedicineSuggestion.findOne({
    _id: req.params.suggestionId,
    pharmacy: req.pharmacy._id,
  }).lean();

  if (!suggestion) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Medicine suggestion not found');

  const response = new ApiResponse(
    HTTP_STATUS.OK,
    { suggestion: toSuggestion(suggestion) },
    'Medicine suggestion fetched successfully'
  );
  res.status(response.statusCode).json(response);
};
