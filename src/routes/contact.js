// Contact form submissions, stored for the admin side to read.
import { Router } from 'express';
import { z } from 'zod';
import pool from '../db.js';
import { ok, parse } from '../lib/http.js';

const router = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(120),
  email: z.string().trim().email('Please enter a valid email').max(160),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\s-]{10,15}$/, 'Please enter a valid phone number')
    .optional()
    .or(z.literal('')),
  message: z.string().trim().min(5, 'Please enter your message').max(2000),
});

router.post('/contact', async (req, res) => {
  const { name, email, phone, message } = parse(contactSchema, req.body);
  await pool.query(
    'INSERT INTO contact_messages (name, email, phone, message) VALUES (?, ?, ?, ?)',
    [name, email, phone || null, message],
  );
  ok(res, null, 'Message received', 201);
});

export default router;
