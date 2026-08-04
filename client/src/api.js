async function request(path, options = {}) {
  const res = await fetch(path, options);
  let data;
  // WORKAROUND: error bodies aren't always valid JSON; don't crash parsing them.
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || (data && data.error)) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  plugins() {
    return request('/api/plugins');
  },
  start(id) {
    return request(`/api/plugins/${id}/start`, { method: 'POST' });
  },
  stop(id) {
    return request(`/api/plugins/${id}/stop`, { method: 'POST' });
  },
  history() {
    return request('/api/history');
  }
};
