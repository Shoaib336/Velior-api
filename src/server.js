// Entry point: loads env vars and starts the HTTP server.
import 'dotenv/config';
import app from './app.js';

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`perfume-api listening on port ${port}`));
