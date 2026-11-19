# QuantPulse AI

A mobile-first Next.js market research dashboard with technical indicators, public market/news data, a watchlist scanner, and budget-aware trade scenarios.

## Run locally

```bash
npm install
npm run dev
```

Optional environment variables:

```dotenv
GROQ_API_KEY=              # Enables Llama 3.3 70B rationale generation
ALPHA_VANTAGE_API_KEY=     # Optional stock data fallback
NEXT_PUBLIC_SUPABASE_URL=  # Enables email/password authentication
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Public Yahoo Finance, Binance, CoinGecko, and CryptoCompare endpoints are used without credentials where available. Rate limits or unsupported symbols can result in deterministic simulated candles; the dashboard labels fallback data. GBP estimates for non-GBP assets use an approximate USD/GBP conversion.

All analysis is for education and research only. Trade scenarios and heuristic scores are not forecasts or financial advice. This starter does not execute trades or store account balances.