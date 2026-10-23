// Admin JWTs. The token carries the admin's token_version; bumping it (password
// reset or change) signs every older token out.
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { HttpError } from '../lib/http.js';

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
};

export const signToken = (admin) =>
  jwt.sign({ sub: String(admin.id), v: admin.token_version }, secret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

export const shapeAdmin = (a) => ({ name: a.name, email: a.email });

/** Rejects with 401 unless a valid Bearer token for a current admin is sent; sets req.admin. */
export const requireAdmin = async (req, res, next) => {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Please sign in');

  let claims;
  try {
    claims = jwt.verify(token, secret());
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  const [[admin]] = await pool.query('SELECT * FROM admins WHERE id = ?', [Number(claims.sub)]);
  if (!admin || admin.token_version !== claims.v) {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  req.admin = admin;
  next();
};
