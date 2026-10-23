// Read-only catalogue + promo check used by the cart.
import { Router } from 'express';
import { z } from 'zod';
import { loadProducts, findPromo } from '../lib/catalogue.js';
import { HttpError, ok, parse } from '../lib/http.js';

const router = Router();

const stripId = ({ id, ...rest }) => rest; // eslint-disable-line no-unused-vars

router.get('/products', async (req, res) => {
  const products = await loadProducts();
  ok(res, { products: products.map(stripId) });
});

router.get('/products/:slug', async (req, res) => {
  const [product] = await loadProducts(undefined, { slugs: [req.params.slug] });
  if (!product) throw new HttpError(404, 'Product not found');
  ok(res, { product: stripId(product) });
});

router.post('/promo/validate', async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(1).max(40) }), req.body);
  const promo = await findPromo(undefined, code);
  if (!promo) throw new HttpError(404, 'Invalid promo code');
  ok(res, { code: promo.code, discountRate: promo.rate });
});

export default router;
