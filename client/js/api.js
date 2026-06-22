// Shared API helper + auth utilities

const api = {
  async _fetch(method, url, body) {
    const token = localStorage.getItem('wg_token');
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch (err) {
      return { error: err.message };
    }
  },
  get: (url) => api._fetch('GET', url),
  post: (url, body) => api._fetch('POST', url, body),
  del: (url) => api._fetch('DELETE', url),
};

function requireAuth() {
  if (!localStorage.getItem('wg_token')) {
    window.location.href = '/login.html';
  }
}

function logout() {
  localStorage.removeItem('wg_token');
  localStorage.removeItem('wg_username');
  localStorage.removeItem('wg_char_id');
  window.location.href = '/login.html';
}
