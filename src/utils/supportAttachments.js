import { HTTP_STATUS } from '../constants/index.js';
import {
  SUPPORT_ALLOWED_ATTACHMENT_MIME_TYPES,
  SUPPORT_MAX_ATTACHMENT_BYTES,
  SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE,
} from '../constants/support.constants.js';
import { isPrivateStorageConfigured } from '../config/storage.js';
import { ApiError } from './ApiError.js';

export const normalizeAttachments = (attachments = []) => {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  if (!isPrivateStorageConfigured()) {
    throw new ApiError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      'Private object storage is not configured. Attachments cannot be accepted yet.'
    );
  }

  if (attachments.length > SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      `A maximum of ${SUPPORT_MAX_ATTACHMENTS_PER_MESSAGE} attachments is allowed`
    );
  }

  return attachments.map((attachment) => {
    const fileType = attachment.fileType?.trim().toLowerCase();
    const sizeBytes = Number(attachment.sizeBytes || 0);

    if (!SUPPORT_ALLOWED_ATTACHMENT_MIME_TYPES.includes(fileType)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Attachment MIME type is not allowed');
    }

    if (sizeBytes < 1 || sizeBytes > SUPPORT_MAX_ATTACHMENT_BYTES) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Attachment size is invalid');
    }

    if (!attachment.fileKey?.startsWith('private/')) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Attachment fileKey must reference private storage');
    }

    return {
      fileKey: attachment.fileKey.trim(),
      fileType,
      fileName: attachment.fileName?.trim()?.slice(0, 200),
      sizeBytes,
      uploadedAt: new Date(),
    };
  });
};

export const toPublicAttachments = (attachments = []) =>
  attachments.map((attachment) => ({
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt,
  }));
