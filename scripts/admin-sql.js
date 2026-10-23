// Prints the SQL that creates (or resets) an admin login — it doesn't touch
// the database; run the printed statement yourself.
//   npm run admin:sql -- --name "Ayesha" --email ayesha@example.com --password "a long password"
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';

const { values } = parseArgs({
  options: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' } },
});

const name = values.name?.trim();
const email = values.email?.trim().toLowerCase();
const password = values.password ?? '';

if (!name || !email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
  console.error('Usage: npm run admin:sql -- --name "Name" --email you@example.com --password "at least 8 chars"');
  process.exit(1);
}

const q = (v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const hash = await bcrypt.hash(password, 12);

console.log(`INSERT INTO admins (name, email, password_hash) VALUES (${q(name)}, ${q(email)}, ${q(hash)})
  ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), token_version = token_version + 1;`);
