const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const CACHE_TTL = 5 * 60 * 1000;
const cache = { updatedAt: null, crypto: null, forex: null, sources: {} };

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'AnnyCrypto/1.0' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function refreshCrypto() {
  const ids = 'bitcoin,ethereum,solana,binancecoin';
  const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
  const symbols = [['BTC', 'bitcoin'], ['ETH', 'ethereum'], ['SOL', 'solana'], ['BNB', 'binancecoin']];
  cache.crypto = symbols.map(([symbol, id]) => ({ symbol, price: data[id]?.usd ?? null, change: data[id]?.usd_24h_change ?? null }));
  cache.sources.crypto = { provider: 'CoinGecko', status: 'live', fetchedAt: new Date().toISOString() };
}

async function refreshForex() {
  // ECB reference rates are a trustworthy daily baseline. A licensed intraday feed
  // can be enabled later without changing the dashboard contract.
  const data = await fetchJson('https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY+AUD.EUR.SP00.A?format=jsondata');
  const series = data?.data?.dataSets?.[0]?.series || {};
  const values = {};
  for (const item of Object.values(series)) {
    const currency = item.seriesKey?.CURRENCY || item.key?.CURRENCY;
    const observations = item.observations || {};
    const latest = Object.values(observations).at(-1)?.[0];
    if (currency && latest) values[currency] = Number(latest);
  }
  const usd = values.USD || 1.08, gbp = values.GBP || 0.86, jpy = values.JPY || 165, aud = values.AUD || 1.64;
  cache.forex = [
    { symbol: 'EUR/USD', price: usd, change: null },
    { symbol: 'GBP/USD', price: gbp / usd, change: null },
    { symbol: 'USD/JPY', price: jpy / usd, change: null },
    { symbol: 'AUD/USD', price: aud / usd, change: null }
  ];
  cache.sources.forex = { provider: 'European Central Bank', status: 'reference', fetchedAt: new Date().toISOString() };
}

async function refreshAll() {
  const results = await Promise.allSettled([refreshCrypto(), refreshForex()]);
  results.forEach((result, index) => {
    if (result.status === 'rejected') cache.sources[index === 0 ? 'crypto' : 'forex'] = { provider: index === 0 ? 'CoinGecko' : 'European Central Bank', status: 'unavailable', error: result.reason.message, fetchedAt: new Date().toISOString() };
  });
  cache.updatedAt = new Date().toISOString();
  console.log(`[data] refresh ${cache.updatedAt}`, cache.sources);
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  response.end(JSON.stringify(body));
}

function serveStatic(request, response) {
  let requested = new URL(request.url, 'http://localhost').pathname;
  if (requested === '/') requested = '/index.html';
  const file = path.resolve(ROOT, `.${requested}`);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(response, { error: 'Not found' }, 404);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
  response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
  if (request.url.startsWith('/api/market')) {
    if (!cache.updatedAt || Date.now() - Date.parse(cache.updatedAt) > CACHE_TTL) await refreshAll();
    return sendJson(response, { updatedAt: cache.updatedAt, crypto: cache.crypto, forex: cache.forex, sources: cache.sources });
  }
  serveStatic(request, response);
});

refreshAll().catch(error => console.error('[data] initial refresh failed:', error.message));
setInterval(() => refreshAll().catch(error => console.error('[data] scheduled refresh failed:', error.message)), CACHE_TTL);
server.listen(PORT, () => console.log(`AnnyCrypto running at http://localhost:${PORT}`));
