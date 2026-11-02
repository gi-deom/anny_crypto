const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const CACHE_TTL = 5 * 60 * 1000;
const cache = { updatedAt: null, crypto: null, forex: null, sources: {} };

async function fetchText(url) {
  const response = await fetch(url, { headers: { accept: 'application/json,text/csv', 'user-agent': 'AnnyCrypto/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}
async function fetchJson(url) { return JSON.parse(await fetchText(url)); }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function calculateRSI(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) { const change = values[i] - values[i - 1]; if (change >= 0) gains += change; else losses -= change; }
  if (!losses) return 70;
  return 100 - (100 / (1 + (gains / period) / (losses / period)));
}
function calculateSignal(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 8) return { signal: 'HOLD', confidence: 35, buyProbability: 25, holdProbability: 50, sellProbability: 25, features: { history: clean.length } };
  const last = clean.at(-1), weekAgo = clean[Math.max(0, clean.length - 8)], short = average(clean.slice(-5)), long = average(clean.slice(-20));
  const momentum = ((last / weekAgo) - 1) * 100, trend = ((short / long) - 1) * 100, rsi = calculateRSI(clean);
  const returns = clean.slice(1).map((value, index) => (value / clean[index]) - 1), meanReturn = average(returns), volatility = Math.sqrt(average(returns.map(value => (value - meanReturn) ** 2))) * 100;
  const score = Math.max(-1, Math.min(1, (momentum / 8) * 0.42 + (trend / 4) * 0.28 + ((rsi - 50) / 30) * 0.2 - Math.max(0, volatility - 4) / 20 * 0.1));
  const signal = score > 0.12 ? 'BUY' : score < -0.12 ? 'SELL' : 'HOLD';
  const confidence = Math.min(92, Math.round(48 + Math.abs(score) * 42 + Math.min(8, clean.length / 10)));
  let buyProbability = Math.round(33 + score * 31), sellProbability = Math.round(33 - score * 31), holdProbability = 100 - buyProbability - sellProbability;
  if (signal === 'HOLD') holdProbability = Math.max(38, holdProbability);
  const total = buyProbability + holdProbability + sellProbability;
  buyProbability = Math.round((buyProbability / total) * 100); holdProbability = Math.round((holdProbability / total) * 100); sellProbability = 100 - buyProbability - holdProbability;
  return { signal, confidence, buyProbability, holdProbability, sellProbability, features: { history: clean.length, momentum: Number(momentum.toFixed(2)), trend: Number(trend.toFixed(2)), rsi: Number(rsi.toFixed(1)), volatility: Number(volatility.toFixed(2)) } };
}

async function refreshCrypto() {
  const coins = [['BTC', 'Bitcoin', 'bitcoin'], ['ETH', 'Ethereum', 'ethereum'], ['SOL', 'Solana', 'solana'], ['BNB', 'BNB', 'binancecoin']];
  const quotes = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd&include_24hr_change=true');
  const assets = await Promise.all(coins.map(async ([symbol, name, id]) => { try { const history = await fetchJson(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`); const prices = (history.prices || []).map(point => Number(point[1])); return { symbol, name, price: quotes[id]?.usd ?? prices.at(-1), change: quotes[id]?.usd_24h_change ?? null, ...calculateSignal(prices), dataSource: 'CoinGecko market chart' }; } catch (error) { return { symbol, name, price: quotes[id]?.usd ?? null, change: quotes[id]?.usd_24h_change ?? null, ...calculateSignal([]), dataSource: 'CoinGecko spot only', warning: error.message }; } }));
  cache.crypto = assets; cache.sources.crypto = { provider: 'CoinGecko', status: 'live', mode: 'spot + 30-day history', fetchedAt: new Date().toISOString() };
}
function parseECB(csv) { const rows = csv.trim().split(/\r?\n/).slice(1).map(row => row.split(',')); const grouped = {}; rows.forEach(columns => { const currency = columns[2], date = columns[6], value = Number(columns[7]); if (currency && date && Number.isFinite(value)) (grouped[currency] ||= []).push({ date, value }); }); return grouped; }
async function refreshForex() {
  const csv = await fetchText('https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY+AUD.EUR.SP00.A?startPeriod=2026-07-01&format=csvdata');
  const grouped = parseECB(csv), usd = grouped.USD?.at(-1)?.value, gbp = grouped.GBP?.at(-1)?.value, jpy = grouped.JPY?.at(-1)?.value, aud = grouped.AUD?.at(-1)?.value;
  if (![usd, gbp, jpy, aud].every(Number.isFinite)) throw new Error('ECB returned incomplete FX data');
  const definitions = [['EUR/USD', 'Euro / US Dollar', usd, grouped.USD], ['GBP/USD', 'British Pound / Dollar', usd / gbp, grouped.GBP], ['USD/JPY', 'US Dollar / Yen', jpy / usd, grouped.JPY], ['AUD/USD', 'Australian Dollar / Dollar', usd / aud, grouped.AUD]];
  cache.forex = definitions.map(([symbol, name, price, series]) => { const values = series.map(item => item.value); const transformed = symbol === 'GBP/USD' ? values.map(value => usd / value) : symbol === 'USD/JPY' ? values.map(value => value / usd) : symbol === 'AUD/USD' ? values.map(value => usd / value) : values; const model = calculateSignal(transformed); return { symbol, name, price, change: transformed.length > 1 ? ((price / transformed.at(-2)) - 1) * 100 : null, ...model, dataSource: 'ECB reference rates' }; });
  cache.sources.forex = { provider: 'European Central Bank', status: 'reference', mode: 'daily rates + history', fetchedAt: new Date().toISOString() };
}
async function refreshAll() { const results = await Promise.allSettled([refreshCrypto(), refreshForex()]); results.forEach((result, index) => { if (result.status === 'rejected') cache.sources[index ? 'forex' : 'crypto'] = { provider: index ? 'European Central Bank' : 'CoinGecko', status: 'unavailable', error: result.reason.message, fetchedAt: new Date().toISOString() }; }); cache.updatedAt = new Date().toISOString(); console.log(`[data] refresh ${cache.updatedAt}`, cache.sources); }
function sendJson(response, body, status = 200) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); response.end(JSON.stringify(body)); }
function serveStatic(request, response) { let requested = new URL(request.url, 'http://localhost').pathname; if (requested === '/') requested = '/index.html'; const file = path.resolve(ROOT, `.${requested}`); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(response, { error: 'Not found' }, 404); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }; response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(file).pipe(response); }
const server = http.createServer(async (request, response) => { if (request.url.startsWith('/api/market')) { if (!cache.updatedAt || Date.now() - Date.parse(cache.updatedAt) > CACHE_TTL) await refreshAll(); return sendJson(response, { updatedAt: cache.updatedAt, crypto: cache.crypto, forex: cache.forex, sources: cache.sources }); } serveStatic(request, response); });
refreshAll().catch(error => console.error('[data] initial refresh failed:', error.message)); setInterval(() => refreshAll().catch(error => console.error('[data] scheduled refresh failed:', error.message)), CACHE_TTL); server.listen(PORT, () => console.log(`AnnyCrypto running at http://localhost:${PORT}`));
