// Store-wide settings, one JSON row per section in `settings`. Missing rows
// or keys fall back to DEFAULTS (the values the storefront shipped with), so
// the table can start empty.
import { z } from 'zod';
import pool from '../db.js';

export const DEFAULTS = {
  store: { deliveryFee: 150, estimatedDelivery: '3-5 Days', lowStockThreshold: 5 },
  announcement: {
    enabled: true,
    text: 'Exclusive Online Offer: Flat 10% OFF on Your First Order | Use Code: FIRST10',
  },
  contact: {
    helpline: '+92 302 5335334',
    whatsapp: '+92 302 5335334',
    email: 'veliorfragrances@gmail.com',
    responseNote: 'Under 2 hours. We read every message and reply the same day, 7 days a week.',
  },
  socials: {
    instagram: 'https://instagram.com',
    facebook: 'https://facebook.com',
    tiktok: 'https://tiktok.com',
    linkedin: 'https://linkedin.com',
    // Behind the storefront's "Write a review" button (empty hides it).
    googleReview: '',
  },
  stats: { fragrancesSold: 1000, ordersInQueue: 120, positiveRating: 98.5, googleReviews: 136 },
  // Printed on partner invoices (admin only).
  invoice: {
    accountNo: '0104306225392',
    accountTitle: 'Usman Haider',
    bank: 'UBL',
    website: 'www.veliorfragrances.com',
    instagram: '@veliorfragrances',
    phone: '03025009486',
  },
};

const whole = (label, max = 10_000_000) =>
  z
    .number({ error: `Enter the ${label}` })
    .int(`The ${label} must be a whole number`)
    .min(0, `The ${label} can't be negative`)
    .max(max, `The ${label} is too large`);
const phone = z
  .string()
  .trim()
  .regex(/^$|^[0-9+\s-]{10,20}$/, 'Enter a valid phone number');
const link = z
  .string()
  .trim()
  .max(300)
  .regex(/^$|^https?:\/\/\S+$/, 'Enter a full link starting with https://');

/** Each section is saved whole — the admin sends every field of it. */
export const sectionSchemas = {
  store: z.object({
    deliveryFee: whole('delivery fee', 100_000),
    estimatedDelivery: z.string().trim().min(1, 'Enter a delivery estimate').max(60),
    lowStockThreshold: whole('alert level', 10_000),
  }),
  announcement: z.object({
    enabled: z.boolean(),
    text: z.string().trim().max(160, 'Keep it under 160 characters'),
  }),
  contact: z.object({
    helpline: phone,
    whatsapp: phone,
    email: z.union([z.literal(''), z.string().trim().email('Enter a valid email').max(160)]),
    responseNote: z.string().trim().max(200),
  }),
  socials: z.object(Object.fromEntries(Object.keys(DEFAULTS.socials).map((k) => [k, link]))),
  stats: z.object({
    fragrancesSold: whole('number'),
    ordersInQueue: whole('number'),
    positiveRating: z.number({ error: 'Enter a rating' }).min(0).max(100, 'Use a percentage up to 100'),
    googleReviews: whole('number'),
  }),
  invoice: z.object({
    accountNo: z.string().trim().max(40),
    accountTitle: z.string().trim().max(80),
    bank: z.string().trim().max(80),
    website: z.string().trim().max(80),
    instagram: z.string().trim().max(60),
    phone: z.string().trim().max(20),
  }),
};

export const settingsPatchSchema = z
  .object(Object.fromEntries(Object.entries(sectionSchemas).map(([k, s]) => [k, s.optional()])))
  .refine((p) => Object.values(p).some(Boolean), 'Nothing to save');

export const loadSettings = async (conn = pool) => {
  const [rows] = await conn.query('SELECT section, data FROM settings');
  const stored = Object.fromEntries(
    rows.map((r) => [r.section, typeof r.data === 'string' ? JSON.parse(r.data) : r.data]),
  );
  return Object.fromEntries(
    Object.entries(DEFAULTS).map(([section, defaults]) => [
      section,
      // Only the keys a section still has — dropped ones (old YouTube/Twitter links) stay hidden.
      Object.fromEntries(Object.keys(defaults).map((k) => [k, stored[section]?.[k] ?? defaults[k]])),
    ]),
  );
};

export const saveSettings = async (patch, conn = pool) => {
  for (const [section, data] of Object.entries(patch)) {
    if (!data) continue;
    await conn.query(
      'INSERT INTO settings (section, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
      [section, JSON.stringify(data)],
    );
  }
};

/** What the storefront may see (no admin-only knobs). */
export const publicSettings = (s) => ({
  store: { deliveryFee: s.store.deliveryFee, estimatedDelivery: s.store.estimatedDelivery },
  announcement: s.announcement,
  contact: s.contact,
  socials: s.socials,
  stats: s.stats,
});
