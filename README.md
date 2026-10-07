# perfume-api

Node.js (Express + MySQL) backend for the perfume website. Initial setup only: no endpoints besides `/api/health` yet.

## Run

```
npm install
cp .env.example .env
npm run dev
```

Health check: http://localhost:5000/api/health

## Next steps

1. Create the MySQL database
2. Fill in the `DB_*` values in `.env`
3. Write `db/schema.sql`
4. Add routes in `src/routes/`
