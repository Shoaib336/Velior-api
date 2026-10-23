// The Contact page inbox.
import { Router } from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { HttpError, idParam, ok, paging, parse } from '../../lib/http.js';

const router = Router();

const shape = (m) => ({
  id: m.id,
  name: m.name,
  email: m.email,
  phone: m.phone,
  message: m.message,
  isRead: Boolean(m.is_read),
  createdAt: m.created_at,
});

const like = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

router.get('/messages', async (req, res) => {
  const { pageSize, offset } = paging(req.query, { size: 200 });
  const where = [];
  const params = [];
  if (req.query.status === 'unread') where.push('is_read = 0');
  if (req.query.status === 'read') where.push('is_read = 1');
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (q) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR message LIKE ?)');
    params.push(like(q), like(q), like(q), like(q));
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT * FROM contact_messages ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM contact_messages ${sql}`, params);
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE is_read = 0');
  ok(res, { messages: rows.map(shape), total, unread });
});

router.patch('/messages/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const { isRead } = parse(z.object({ isRead: z.boolean() }), req.body);
  const [result] = await pool.query('UPDATE contact_messages SET is_read = ? WHERE id = ?', [isRead, id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Message not found');
  const [[row]] = await pool.query('SELECT * FROM contact_messages WHERE id = ?', [id]);
  ok(res, { message: shape(row) });
});

router.delete('/messages/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM contact_messages WHERE id = ?', [idParam(req.params.id)]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Message not found');
  ok(res, null, 'Message deleted');
});

export default router;
