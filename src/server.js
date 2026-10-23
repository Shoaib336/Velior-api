// Entry point: loads env vars and starts the HTTP server.
import 'dotenv/config';
import app from './app.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters (see README).');
  process.exit(1);
}

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`perfume-api listening on port ${port}`));
