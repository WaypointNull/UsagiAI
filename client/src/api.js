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
  },
  repos() {
    return request('/api/repos');
  },
  repo(owner, repo) {
    return request(`/api/repos/${owner}/${repo}`);
  },
  installRepo(owner, repo, tag) {
    return request(`/api/repos/${owner}/${repo}/install`, {
      method: 'POST',
      body: JSON.stringify({ tag })
    });
  },
  updateRepo(owner, repo, tag) {
    return request(`/api/repos/${owner}/${repo}/update`, {
      method: 'POST',
      body: JSON.stringify({ tag })
    });
  },
  repairRepo(owner, repo) {
    return request(`/api/repos/${owner}/${repo}/repair`, { method: 'POST' });
  },
  uninstallRepo(owner, repo) {
    return request(`/api/repos/${owner}/${repo}/uninstall`, { method: 'POST' });
  }
};
