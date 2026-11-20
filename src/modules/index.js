/**
 * Mongoose model registry for MediReech.
 * Import this module during application startup so all schemas and indexes are registered.
 *
 * Relationships:
 * - User → Pharmacy (owner)
 * - User ↔ PharmacyStaff ↔ Pharmacy
 * - Pharmacy + Medicine → Inventory (pharmacy-specific stock)
 * - User + Pharmacy → Reservation
 * - Reservation → Prescription (optional)
 * - User → AuditLog (actor)
 */
export { User } from './users/user.model.js';
export { Pharmacy } from './pharmacies/pharmacy.model.js';
export { PharmacyStaff } from './pharmacy-staff/pharmacyStaff.model.js';
export { Medicine } from './medicines/medicine.model.js';
export { Inventory } from './inventory/inventory.model.js';
export { StockMovement } from './inventory/stockMovement.model.js';
export { NotificationOutbox } from './notifications/notificationOutbox.model.js';
export { Notification } from './notifications/notification.model.js';
export { DeviceToken } from './notifications/deviceToken.model.js';
export { NotificationPreference } from './notifications/notificationPreference.model.js';
export { Payment } from './payments/payment.model.js';
export { Refund } from './payments/refund.model.js';
export { PaymentWebhookEvent } from './payments/paymentWebhookEvent.model.js';
export { Reservation } from './reservations/reservation.model.js';
export { Prescription } from './prescriptions/prescription.model.js';
export { AuditLog } from './audit-logs/auditLog.model.js';
export { Otp } from './auth/otp.model.js';
export { UserSession } from './auth/userSession.model.js';
export { SupportTicket } from './support/supportTicket.model.js';
export { SupportTicketMessage } from './support/supportTicketMessage.model.js';
export { ServiceArea } from './admin/serviceArea.model.js';
export { MedicineSuggestion } from './admin/medicineSuggestion.model.js';
export { PlatformSettings } from './admin/platformSettings.model.js';
