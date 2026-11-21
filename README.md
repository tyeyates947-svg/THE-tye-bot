# QuantPulse AI

A mobile-first Next.js market research dashboard with technical indicators, public market/news data, a watchlist scanner, social trader profiles, simulated Trade With positions and a future-event planner.

## Run locally

```bash
npm install
npm run dev
```

Set these variables in local `.env.local` and in the Vercel project settings:

```dotenv
GROQ_API_KEY=                  # Required for AI analysis; uses Groq GPT OSS 120B with 20B fallback
SUPABASE_URL=https://...       # Supabase project URL (NEXT_PUBLIC_SUPABASE_URL also works)
SUPABASE_SERVICE_ROLE_KEY=     # Server only; never prefix with NEXT_PUBLIC_
ALPHA_VANTAGE_API_KEY=         # Optional stock-data fallback
PAPER_ACCOUNT_ENCRYPTION_KEY=  # Optional: 64 hex characters; encrypts connected paper-account credentials
```

### Supabase setup

1. In Supabase SQL Editor, run [`supabase/migrations/20261119000000_quantpulse_social_paper_trading.sql`](./supabase/migrations/20261119000000_quantpulse_social_paper_trading.sql), [`supabase/migrations/20261119100000_email_password_auth.sql`](./supabase/migrations/20261119100000_email_password_auth.sql), [`supabase/migrations/20261119110000_auth_sessions_schema_cache_repair.sql`](./supabase/migrations/20261119110000_auth_sessions_schema_cache_repair.sql), then [`supabase/migrations/20261120100000_quantpulse_trade_planner_accounts_chat.sql`](./supabase/migrations/20261120100000_quantpulse_trade_planner_accounts_chat.sql).
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Vercel for every environment you use, then redeploy.
3. Keep the service-role key private. Profile and trade tables have RLS enabled and are accessed only by server API routes. The existing `paper_trades` table stores simulated Trade With positions; no additional schema is required for public profiles, themes, or notifications.

The authentication migrations ask PostgREST to reload its schema cache. If account creation reports that `public.auth_sessions` is missing from the schema cache, run the repair migration above in the same Supabase project configured by `SUPABASE_URL`, then retry account creation. The repair safely creates the table if it is absent and refreshes the cache. To enable external practice accounts, set `PAPER_ACCOUNT_ENCRYPTION_KEY` to a persistent 32-byte key encoded as 64 hex characters (for example, generate one with `openssl rand -hex 32`) in local `.env.local` and your server deployment. Losing or rotating this key makes previously stored account credentials unreadable; disconnect and reconnect those accounts after a rotation.

Email and password verification happens server-side using salted scrypt hashes, with a database-backed limit of five attempts per email/IP per 15 minutes. Passwords must be 8–128 characters. A random, revocable session token is saved in browser `localStorage` for 30 days. Because browser storage is exposed to same-origin script, keep dependencies and deployment secrets protected. Existing PIN-only accounts cannot be automatically converted because their email addresses and passwords were never collected; users must create a new account. New accounts start with £10,000 virtual balance. Profile photos are client-resized JPEG data URLs; no storage bucket is required.

Yahoo Finance, Binance, CoinGecko and CryptoCompare public endpoints are used without paid API credentials. Provider limits or unsupported symbols may lead to labeled simulated candles. Non-GBP position conversion uses an approximate USD/GBP rate. Active and scheduled Trade Withs refresh live prices and request a batched Groq check-in every 30 seconds while the dashboard is open; target, stop and duration-based auto-close checks also run during those refreshes. Scheduled entries and expiry execution require the app to be open and live market data to be available. Browser notifications require permission. Chat history is persisted locally per profile ID, and the Future Trade Planner stores plans in local storage.

Trading 212 Practice requires its demo API key and secret (including account, positions, and historical-order read scopes); Alpaca credentials must be for its paper-trading API. Credentials are encrypted server-side with AES-256-GCM and are never exposed in public profiles or leaderboard responses. The public badge and leaderboard show verified paper-account summaries alongside separate in-app Trade With results. Win rates are estimates from recent closed fills (up to 50 Trading 212 orders or 100 Alpaca fills); the AI uses only verified account summary statistics, not credentials.

Groq analysis uses `openai/gpt-oss-120b` with `openai/gpt-oss-20b` fallback and no `response_format`. It refuses to run when `GROQ_API_KEY` is absent or the Groq request fails; it does not fabricate an AI response. Chat requests include the latest ten per-profile messages to support follow-ups and concise conversational answers; structured trade cards are reserved for setup requests. High-Profit Hunter (the default) needs at least two of four directional confirmations—EMA trend, RSI momentum, volume with candle direction, and headline sentiment—and targets a 1:3 risk/reward setup. Strict Sniper requires at least three aligned confirmations including the full EMA trend. Both modes avoid simulated candles, flat markets, and directly tied opposing signals. Win probability is a heuristic, not a statistically validated forecast. All analysis and balances are simulated for education only and are not financial advice or real trading. Six color themes persist in local storage, and the five-step onboarding tour can be replayed from the header.