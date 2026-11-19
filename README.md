# QuantPulse AI

A mobile-first Next.js market research and paper-trading dashboard with technical indicators, public market/news data, a watchlist scanner, social leaderboard and future-event planner.

## Run locally

```bash
npm install
npm run dev
```

Set these variables in local `.env.local` and in the Vercel project settings:

```dotenv
GROQ_API_KEY=                  # Required for AI analysis; Groq llama-3.3-70b-versatile
SUPABASE_URL=https://...       # Supabase project URL (NEXT_PUBLIC_SUPABASE_URL also works)
SUPABASE_SERVICE_ROLE_KEY=     # Server only; never prefix with NEXT_PUBLIC_
ALPHA_VANTAGE_API_KEY=         # Optional stock-data fallback
```

### Supabase setup

1. In Supabase SQL Editor, run [`supabase/migrations/20261119000000_quantpulse_social_paper_trading.sql`](./supabase/migrations/20261119000000_quantpulse_social_paper_trading.sql), then [`supabase/migrations/20261119100000_email_password_auth.sql`](./supabase/migrations/20261119100000_email_password_auth.sql).
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Vercel for every environment you use, then redeploy.
3. Keep the service-role key private. Profile and trade tables have RLS enabled and are accessed only by server API routes. The migrations grant the server role atomic paper-trade and authentication rate-limit RPCs.

The authentication migration asks PostgREST to reload its schema cache. If authentication reports that `qp_record_auth_attempt` is missing from the schema cache, run that migration in the matching Supabase project again.

Email and password verification happens server-side using salted scrypt hashes, with a database-backed limit of five attempts per email/IP per 15 minutes. Passwords must be 8–128 characters. A random, revocable session token is saved in browser `localStorage` for 30 days. Because browser storage is exposed to same-origin script, keep dependencies and deployment secrets protected. Existing PIN-only accounts cannot be automatically converted because their email addresses and passwords were never collected; users must create a new account. New paper-trading accounts start with £10,000 virtual balance. Profile photos are client-resized JPEG data URLs; no storage bucket is required.

Yahoo Finance, Binance, CoinGecko and CryptoCompare public endpoints are used without paid API credentials. Provider limits or unsupported symbols may lead to labeled simulated candles. Non-GBP paper-trade conversion uses an approximate USD/GBP rate.

Groq analysis refuses to run when `GROQ_API_KEY` is absent or the Groq request fails; it does not fabricate an AI response. BUY/SELL requires RSI, EMA trend, volume and headline-sentiment confluence; otherwise the result is WAIT. Win probability is a heuristic, not a statistically validated forecast. All analysis and balances are simulated for education only and are not financial advice or real trading.