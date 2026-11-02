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

The Node service refreshes CoinGecko crypto data and ECB reference FX data on a five-minute schedule, caches timestamps, and exposes `/api/market`. The current UI falls back to demo/indicative data if a provider is unavailable. For production, add a server-side ingestion layer with licensed providers for realtime FX, news/sentiment, on-chain metrics, and macro/COT data; normalize timestamps and symbols, deduplicate overlapping feeds, store raw and derived data, and run a versioned ensemble model. Do not scrape sites or imply that more sources guarantee accuracy. Move authentication to a server, hash passwords, add rate limiting and MFA, and persist user watchlists server-side. Signals are illustrative model output, not guaranteed predictions or financial advice.
