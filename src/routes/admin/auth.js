// Admin sign-in, password reset by email, and the signed-in admin's account.
import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import pool from '../../db.js';
import { HttpError, fieldError, isDuplicate, ok, parse } from '../../lib/http.js';
import { sendMail } from '../../lib/mailer.js';
import { requireAdmin, shapeAdmin, signToken } from '../../middleware/auth.js';

const router = Router();

const RESET_MINUTES = 60;
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(160);
const newPassword = z.string().min(8, 'Use at least 8 characters').max(200);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Compared against when the email is unknown, so both paths take as long.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/login', async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1, 'Enter your password').max(200) }), req.body);
  const [[admin]] = await pool.query('SELECT * FROM admins WHERE email = ?', [body.email]);
  const matches = await bcrypt.compare(body.password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !matches) throw new HttpError(401, 'Incorrect email or password');

  await pool.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
  ok(res, { token: signToken(admin), admin: shapeAdmin(admin) });
});

// Always answers the same way so it can't be used to find admin emails.
router.post('/forgot-password', async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const [[admin]] = await pool.query('SELECT id, name, email FROM admins WHERE email = ?', [body.email]);
  if (admin) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'UPDATE admins SET reset_token_hash = ?, reset_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
      [sha256(token), RESET_MINUTES, admin.id],
    );
    const base = (process.env.ADMIN_URL || 'http://localhost:5174').replace(/\/+$/, '');
    const link = `${base}/reset-password?token=${token}`;
    try {
      await sendMail({
        to: admin.email,
        subject: 'Reset your Velior Admin password',
        text: `Hi ${admin.name},\n\nUse this link to choose a new password (it works for ${RESET_MINUTES} minutes):\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.\n\n— Velior Fragrances`,
      });
    } catch (err) {
      console.error('Password reset email failed', err);
    }
  }
  ok(res, null, 'If that email belongs to an admin, a reset link is on its way');
});

router.post('/reset-password', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password: newPassword }), req.body);
  const [[admin]] = await pool.query(
    'SELECT id FROM admins WHERE reset_token_hash = ? AND reset_expires_at > NOW()',
    [sha256(body.token)],
  );
  if (!admin) throw new HttpError(400, 'This reset link has expired or was already used. Request a new one.');

  await pool.query(
    `UPDATE admins SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL,
       token_version = token_version + 1 WHERE id = ?`,
    [await bcrypt.hash(body.password, 12), admin.id],
  );
  ok(res, null, 'Password changed. You can sign in now.');
});

router.use(requireAdmin);

router.get('/me', (req, res) => {
  ok(res, { admin: shapeAdmin(req.admin) });
});

router.patch('/me', async (req, res) => {
  const body = parse(
    z.object({ name: z.string().trim().min(2, 'Enter your name').max(80), email }),
    req.body,
  );
  try {
    await pool.query('UPDATE admins SET name = ?, email = ? WHERE id = ?', [body.name, body.email, req.admin.id]);
  } catch (err) {
    if (isDuplicate(err)) throw fieldError(409, 'email', 'Another admin already uses this email');
    throw err;
  }
  ok(res, { admin: { name: body.name, email: body.email } }, 'Profile saved');
});

// Signs other sessions out; the fresh token keeps this one signed in.
router.post('/change-password', async (req, res) => {
  const body = parse(
    z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(200), newPassword }),
    req.body,
  );
  if (!(await bcrypt.compare(body.currentPassword, req.admin.password_hash))) {
    throw fieldError(400, 'currentPassword', 'Your current password is incorrect');
  }
  await pool.query('UPDATE admins SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [
    await bcrypt.hash(body.newPassword, 12),
    req.admin.id,
  ]);
  ok(res, { token: signToken({ ...req.admin, token_version: req.admin.token_version + 1 }) }, 'Password changed');
});

export default router;
