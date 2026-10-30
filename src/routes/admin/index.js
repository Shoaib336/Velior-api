// Everything under /api/admin. Only the auth routes for signing in and
// resetting a password are open; the rest need a Bearer token.
import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import authRoutes from './auth.js';
import dashboardRoutes from './dashboard.js';
import orderRoutes from './orders.js';
import productRoutes from './products.js';
import uploadRoutes from './uploads.js';
import promoCodeRoutes from './promoCodes.js';
import messageRoutes from './messages.js';
import contentRoutes from './content.js';
import settingsRoutes from './settings.js';
import stockPurchaseRoutes from './stockPurchases.js';
import expenseRoutes from './expenses.js';
import partnerStoreRoutes from './partnerStores.js';
import partnerInvoiceRoutes from './partnerInvoices.js';
import investorRoutes from './investors.js';

const router = Router();

router.use('/auth', authRoutes);
router.use(
  requireAdmin,
  dashboardRoutes,
  orderRoutes,
  productRoutes,
  uploadRoutes,
  promoCodeRoutes,
  messageRoutes,
  contentRoutes,
  settingsRoutes,
  stockPurchaseRoutes,
  expenseRoutes,
  partnerStoreRoutes,
  partnerInvoiceRoutes,
  investorRoutes,
);

export default router;
