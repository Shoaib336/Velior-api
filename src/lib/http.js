// Response envelope + error type shared by every route.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const ok = (res, successResponse = null, message = null, status = 200) =>
  res.status(status).json({ isRequestSuccessful: true, message, successResponse });

/** Parses `data` with a zod schema; throws a 400 carrying the first message. */
export const parse = (schema, data) => {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
  throw new HttpError(400, result.error.issues[0].message, fields);
};

/** A 409/400 pinned to one form field, e.g. fieldError(409, 'slug', 'Taken'). */
export const fieldError = (status, field, message) => new HttpError(status, message, { [field]: message });

/** Positive integer route param (`/messages/:id`) or a 404. */
export const idParam = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Not found');
  return id;
};

/** `page` / `pageSize` query values, clamped. */
export const paging = (query, { size = 20, max = 500 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(max, Math.max(1, Number.parseInt(query.pageSize, 10) || size));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

/** MySQL duplicate-key error (unique index hit). */
export const isDuplicate = (err) => err?.code === 'ER_DUP_ENTRY';
