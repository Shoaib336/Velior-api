// Storefront copy: review cards and FAQs.
import { Router } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../db.js';
import { HttpError, idParam, ok, parse } from '../../lib/http.js';
import { addDays, dayKey, isDayKey } from '../../lib/dates.js';
import { FAQ_CATEGORIES, loadFaqs, loadTestimonials, shapeTestimonial } from '../../lib/content.js';

const router = Router();

// ---------- Testimonials ----------

const testimonialFields = {
  name: z.string().trim().min(2, "Enter the customer's name").max(80),
  text: z.string().trim().min(5, 'Enter the review').max(400, 'Keep it under 400 characters'),
  reviewedAt: z
    .string({ error: 'Pick the review date' })
    .refine(isDayKey, 'Pick the review date')
    // A day of slack for time zones.
    .refine((d) => d <= dayKey(addDays(new Date(), 1)), "The date can't be in the future"),
  featured: z.boolean(),
};
const testimonialCreate = z.object({ ...testimonialFields, featured: testimonialFields.featured.default(true) });
const testimonialPatch = z.object(testimonialFields).partial();

const testimonialColumns = (b) => {
  const cols = {};
  if (b.name !== undefined) cols.name = b.name;
  if (b.text !== undefined) cols.text = b.text;
  if (b.reviewedAt !== undefined) cols.reviewed_at = b.reviewedAt;
  if (b.featured !== undefined) cols.featured = b.featured;
  return cols;
};

const oneTestimonial = async (id) => {
  const [[row]] = await pool.query('SELECT * FROM testimonials WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Review not found');
  return shapeTestimonial(row);
};

router.get('/testimonials', async (req, res) => {
  ok(res, { testimonials: await loadTestimonials() });
});

router.post('/testimonials', async (req, res) => {
  const body = parse(testimonialCreate, req.body);
  const [result] = await pool.query('INSERT INTO testimonials SET ?', [testimonialColumns(body)]);
  ok(res, { testimonial: await oneTestimonial(result.insertId) }, 'Review added', 201);
});

router.patch('/testimonials/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const cols = testimonialColumns(parse(testimonialPatch, req.body));
  if (Object.keys(cols).length) await pool.query('UPDATE testimonials SET ? WHERE id = ?', [cols, id]);
  ok(res, { testimonial: await oneTestimonial(id) }, 'Review saved');
});

router.delete('/testimonials/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM testimonials WHERE id = ?', [idParam(req.params.id)]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Review not found');
  ok(res, null, 'Review deleted');
});

// ---------- FAQs ----------

const faqFields = {
  category: z.enum(FAQ_CATEGORIES, { error: 'Pick a tab' }),
  question: z.string().trim().min(5, 'Enter the question').max(200),
  answer: z.string().trim().min(5, 'Enter the answer').max(1000, 'Keep it under 1000 characters'),
};

const oneFaq = async (id) => {
  const faq = (await loadFaqs()).find((f) => f.id === id);
  if (!faq) throw new HttpError(404, 'FAQ not found');
  return faq;
};

router.get('/faqs', async (req, res) => {
  ok(res, { faqs: await loadFaqs() });
});

router.post('/faqs', async (req, res) => {
  const body = parse(z.object(faqFields), req.body);
  // New questions go to the end.
  const [result] = await pool.query(
    `INSERT INTO faqs (category, question, answer, sort_order)
     SELECT ?, ?, ?, COALESCE(MAX(sort_order), 0) + 1 FROM faqs`,
    [body.category, body.question, body.answer],
  );
  ok(res, { faq: await oneFaq(result.insertId) }, 'FAQ added', 201);
});

router.patch('/faqs/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(z.object(faqFields).partial(), req.body);
  if (Object.keys(body).length) await pool.query('UPDATE faqs SET ? WHERE id = ?', [body, id]);
  ok(res, { faq: await oneFaq(id) }, 'FAQ saved');
});

router.delete('/faqs/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM faqs WHERE id = ?', [idParam(req.params.id)]);
  if (result.affectedRows === 0) throw new HttpError(404, 'FAQ not found');
  ok(res, null, 'FAQ deleted');
});

// `ids` is the whole list in its new order.
router.post('/faqs/reorder', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).max(500) }), req.body);
  const faqs = await transaction(async (conn) => {
    const [rows] = await conn.query('SELECT id FROM faqs FOR UPDATE');
    const known = new Set(rows.map((r) => r.id));
    if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
      throw new HttpError(409, 'The FAQ list changed meanwhile. Reload and try again.');
    }
    for (const [i, id] of ids.entries()) {
      await conn.query('UPDATE faqs SET sort_order = ? WHERE id = ?', [i + 1, id]);
    }
    return loadFaqs(conn);
  });
  ok(res, { faqs }, 'Order saved');
});

export default router;
