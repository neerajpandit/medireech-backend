import crypto from 'node:crypto';
import { SupportTicket } from '../modules/support/supportTicket.model.js';

export const buildSupportTicketNumber = () => {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `ST-${suffix}`;
};

export const generateUniqueSupportTicketNumber = async ({ maxAttempts = 8 } = {}) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ticketNumber = buildSupportTicketNumber();
    const exists = await SupportTicket.exists({ ticketNumber });
    if (!exists) {
      return ticketNumber;
    }
  }

  throw new Error('Unable to generate a unique support ticket number');
};
