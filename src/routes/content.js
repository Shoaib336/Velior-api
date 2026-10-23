// Public storefront content the admin manages: settings, reviews, FAQs.
import { Router } from 'express';
import { ok } from '../lib/http.js';
import { loadSettings, publicSettings } from '../lib/settings.js';
import { loadFaqs, loadTestimonials } from '../lib/content.js';

const router = Router();

router.get('/settings', async (req, res) => {
  ok(res, { settings: publicSettings(await loadSettings()) });
});

router.get('/testimonials', async (req, res) => {
  const testimonials = await loadTestimonials({ featuredOnly: true });
  ok(res, { testimonials: testimonials.map(({ featured, ...t }) => t) }); // eslint-disable-line no-unused-vars
});

router.get('/faqs', async (req, res) => {
  ok(res, { faqs: await loadFaqs() });
});

export default router;
