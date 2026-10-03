// JSON API client. Sends the CSRF token on every state-changing request and
// turns failures into ApiError with a stable code the UI can translate.

let csrf = null;
export const setCsrf = (v) => { csrf = v; };

export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const listeners = new Set();
// Called with the error whenever the server says the session is gone.
export const onUnauthorized = (fn) => listeners.add(fn);

async function request(method, url, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const e = data?.error || {};
    const err = new ApiError(res.status, e.code || (res.status === 401 ? 'unauthorized' : 'server_error'), e.message, e.details, e.requestId);
    if (res.status === 401 && !url.startsWith('/api/auth/login')) listeners.forEach((fn) => fn(err));
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

// Builds a query string, skipping empty values.
export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
