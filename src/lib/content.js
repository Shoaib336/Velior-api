// Review cards and FAQs, read by both the storefront and the admin.
import pool from '../db.js';

/** The storefront's FAQ tabs, in display order. */
export const FAQ_CATEGORIES = ['Product', 'Discovery', 'Shipping', 'Payments'];

export const shapeTestimonial = (t) => ({
  id: t.id,
  name: t.name,
  text: t.text,
  reviewedAt: t.reviewed_at, // "YYYY-MM-DD" (DATE columns come back as strings)
  featured: Boolean(t.featured),
});

/** Newest review first. `featuredOnly` for the storefront. */
export const loadTestimonials = async ({ featuredOnly = false } = {}, conn = pool) => {
  const [rows] = await conn.query(
    `SELECT * FROM testimonials ${featuredOnly ? 'WHERE featured = 1' : ''} ORDER BY reviewed_at DESC, id DESC`,
  );
  return rows.map(shapeTestimonial);
};

export const loadFaqs = async (conn = pool) => {
  const [rows] = await conn.query('SELECT id, category, question, answer FROM faqs ORDER BY sort_order, id');
  return rows;
};
