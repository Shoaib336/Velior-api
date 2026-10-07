// Express app: security headers, CORS, JSON parsing, health route, error handler.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ isRequestSuccessful: true, message: null, successResponse: { status: 'ok' } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    isRequestSuccessful: false,
    message: err.status && err.status < 500 ? err.message : 'Internal server error',
    successResponse: null,
  });
});

export default app;
