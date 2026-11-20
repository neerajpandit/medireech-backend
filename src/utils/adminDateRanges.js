/** Platform analytics date helpers (UTC boundaries). */

export const startOfUtcDay = (date = new Date()) => {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
};

export const startOfUtcMonth = (date = new Date()) => {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return value;
};

export const analyticsDateFormat = (interval) => {
  if (interval === 'weekly') {
    return '%Y-%U';
  }

  if (interval === 'monthly') {
    return '%Y-%m';
  }

  return '%Y-%m-%d';
};
