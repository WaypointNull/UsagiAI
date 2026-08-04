const HUB_URL = process.env.USAGI_HUB_URL;
const TOKEN = process.env.USAGI_PLUGIN_TOKEN;

function enabled() {
  return Boolean(HUB_URL);
}

async function request(method, route, body) {
  if (!enabled()) {
    return null;
  }
  const headers = { 'content-type': 'application/json' };
  if (TOKEN) {
    headers['x-usagi-token'] = TOKEN;
  }
  const options = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${HUB_URL}${route}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`bus ${method} ${route} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function ready() {
  return request('POST', '/bus/ready');
}

async function record(schema, { input, output }) {
  return request('POST', '/bus/history', { schema, input, output });
}

async function history({ plugin, schema }) {
  const qs = new URLSearchParams({ plugin, schema });
  return request('GET', `/bus/history?${qs}`);
}

async function historyLatest({ plugin, schema }) {
  const qs = new URLSearchParams({ from: plugin, schema });
  return request('GET', `/bus/history/latest?${qs}`);
}

module.exports = { enabled, ready, record, history, historyLatest };
