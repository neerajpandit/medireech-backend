import { Router } from 'express';
import { healthRouter } from './health.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { pharmacyRouter } from '../modules/pharmacies/pharmacy.routes.js';
import { adminPharmacyRouter } from '../modules/pharmacies/admin.routes.js';
import { medicineRouter } from '../modules/medicines/medicine.routes.js';
import { adminMedicineRouter } from '../modules/medicines/admin.routes.js';
import { inventoryRouter } from '../modules/inventory/inventory.routes.js';
import { reservationRouter } from '../modules/reservations/reservation.routes.js';
import { notificationRouter } from '../modules/notifications/notification.routes.js';
import { paymentRouter } from '../modules/payments/payment.routes.js';
import { paymentAdminRouter } from '../modules/payments/payment.admin.routes.js';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { supportRouter } from '../modules/support/support.routes.js';
import { supportAdminRouter } from '../modules/support/support.admin.routes.js';

const router = Router();

router.use(healthRouter);
router.use('/auth', authRouter);
router.use('/pharmacies', pharmacyRouter);
router.use('/admin', adminRouter);
router.use('/admin/pharmacies', adminPharmacyRouter);
router.use('/medicines', medicineRouter);
router.use('/admin/medicines', adminMedicineRouter);
router.use('/inventory', inventoryRouter);
router.use('/reservations', reservationRouter);
router.use('/notifications', notificationRouter);
router.use('/payments', paymentRouter);
router.use('/admin/payments', paymentAdminRouter);
router.use('/support', supportRouter);
router.use('/admin/support', supportAdminRouter);

export default router;
