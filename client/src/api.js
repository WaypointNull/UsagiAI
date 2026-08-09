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

async function requestStream(path, options = {}, onProgress) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  if (!res.body) {
    return {};
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;
  let errorPayload = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) {
        continue;
      }
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === 'progress') {
        if (onProgress) {
          onProgress(msg.message, msg.progress);
        }
      } else if (msg.type === 'done') {
        donePayload = msg;
      } else if (msg.type === 'error') {
        errorPayload = msg;
      }
    }
  }
  if (errorPayload) {
    const error = new Error(errorPayload.error);
    error.reason = errorPayload.reason;
    throw error;
  }
  return donePayload || {};
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
  deleteHistory(plugin, schema, id) {
    return request(`/api/history/${plugin}/${schema}/${id}`, { method: 'DELETE' });
  },
  clearHistory(plugin, schema) {
    return request(`/api/history/${plugin}/${schema}`, { method: 'DELETE' });
  },
  deleteFolder(folderId) {
    return request(`/api/history/folder/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
  },
  repos() {
    return request('/api/repos');
  },
  repo(owner, repo) {
    return request(`/api/repos/${owner}/${repo}`);
  },
  installRepo(owner, repo, tag, onProgress) {
    return requestStream(
      `/api/repos/${owner}/${repo}/install`,
      { method: 'POST', body: JSON.stringify({ tag }) },
      onProgress
    );
  },
  updateRepo(owner, repo, tag, onProgress) {
    return requestStream(
      `/api/repos/${owner}/${repo}/update`,
      { method: 'POST', body: JSON.stringify({ tag }) },
      onProgress
    );
  },
  repairRepo(owner, repo, onProgress) {
    return requestStream(`/api/repos/${owner}/${repo}/repair`, { method: 'POST' }, onProgress);
  },
  uninstallRepo(owner, repo, onProgress) {
    return requestStream(`/api/repos/${owner}/${repo}/uninstall`, { method: 'POST' }, onProgress);
  }
};
