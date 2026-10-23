// Calendar days in Node's time zone (set TZ, e.g. Asia/Karachi), as
// "YYYY-MM-DD" keys — the same keys the admin's date pickers send.
const pad = (n) => String(n).padStart(2, '0');

export const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const isDayKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(startOf(value).getTime());

/** Local midnight at the start of a day key. */
export const startOf = (key) => new Date(`${key}T00:00:00`);

export const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/** Dashboard ranges → { from, to } day keys, both inclusive. */
export const presetRange = (preset, today = new Date()) => {
  const to = dayKey(today);
  switch (preset) {
    case '7d':
      return { from: dayKey(addDays(today, -6)), to };
    case '90d':
      return { from: dayKey(addDays(today, -89)), to };
    case 'month':
      return { from: dayKey(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    default:
      return { from: dayKey(addDays(today, -29)), to };
  }
};

/** Every day key from `from` to `to`, inclusive. */
export const eachDay = (from, to) => {
  const days = [];
  for (let d = startOf(from); d <= startOf(to); d = addDays(d, 1)) days.push(dayKey(d));
  return days;
};
