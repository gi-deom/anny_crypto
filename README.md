# Aurum Signal

A self-contained market-intelligence dashboard for crypto and forex research.

## Run it

Start the data service and web server with Node:

```bash
npm start
```

Then visit `http://localhost:8080`.

If npm is not installed, use the equivalent command:

```bash
node server.js
```

## GitHub Pages deployment

GitHub Pages hosts the static frontend only. It cannot run `server.js`, so realtime multi-source data requires deploying `server.js` separately and setting the frontend API URL. Copy `config.example.js` to `config.js`, set `window.ANNYCRYPTO_API_BASE` to the deployed backend URL, then commit both files. In the repository Settings, open Pages, choose **GitHub Actions** as the source, and push to `main`; the included workflow deploys the site automatically. The resulting URL is usually `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

Do not commit provider API keys. Put them in the backend host's environment variables. GitHub Pages is suitable for the interface, not for persistent workers, protected credentials, account authentication, or realtime ingestion.

## Test access

- Email: `test@test.test`
- Password: `giddy@test`

## Data and production notes

The Node service refreshes CoinGecko crypto data and ECB reference FX history on a five-minute schedule, caches timestamps, computes signals from recent momentum, trend, RSI, and volatility, and exposes `/api/market`. The browser also refreshes the endpoint every five minutes and supports the Refresh data button. The current UI falls back to demo data if a provider is unavailable. ECB rates are daily reference data, not realtime executable FX quotes; add a licensed intraday FX provider for that requirement. For production, add licensed news/sentiment, on-chain metrics, and macro/COT feeds; normalize timestamps and symbols, deduplicate overlapping feeds, store raw and derived data, and validate the model out of sample. Do not scrape sites or imply that more sources guarantee accuracy. Move authentication to a server, hash passwords, add rate limiting and MFA, and persist user watchlists server-side. Signals are model outputs, not guaranteed predictions or financial advice.
