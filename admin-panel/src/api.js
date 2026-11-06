const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const ACCESS_TOKEN_KEY = 'furnispace.admin.access';
const REFRESH_TOKEN_KEY = 'furnispace.admin.refresh';
const USER_KEY = 'furnispace.admin.user';

export function getAdminSession() {
  const accessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
  const storedUser = sessionStorage.getItem(USER_KEY);
  return {
    accessToken,
    refreshToken,
    user: storedUser ? JSON.parse(storedUser) : null
  };
}

function storeSession({ accessToken, refreshToken, user }) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAdminSession() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

async function decodeResponse(response) {
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('The server returned an invalid response.');
    }
  }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return payload;
}

async function refreshAdminSession() {
  const { refreshToken } = getAdminSession();
  if (!refreshToken) {
    clearAdminSession();
    throw new Error('Your admin session has expired. Please sign in again.');
  }

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  const payload = await decodeResponse(response);
  if (payload.user?.role !== 'admin') {
    clearAdminSession();
    throw new Error('This account is not authorized for the admin panel.');
  }
  storeSession(payload);
  return payload.accessToken;
}

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, retry = true } = options;
  const headers = new Headers(options.headers || {});
  const { accessToken } = getAdminSession();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (response.status === 401 && retry && path !== '/auth/login') {
    const payload = await response.clone().json().catch(() => ({}));
    if (payload.code === 'TOKEN_EXPIRED') {
      await refreshAdminSession();
      return apiRequest(path, { ...options, retry: false });
    }
    if (path.startsWith('/admin/') || path.startsWith('/delivery/admin/')) {
      clearAdminSession();
    }
  }

  return decodeResponse(response);
}

export async function loginAdmin(identifier, password) {
  const payload = await apiRequest('/auth/login', {
    method: 'POST',
    body: { identifier, password },
    retry: false
  });
  if (payload.user?.role !== 'admin') {
    throw new Error('This account does not have admin access.');
  }
  storeSession(payload);
  return payload.user;
}

export async function logoutAdmin() {
  const { refreshToken } = getAdminSession();
  try {
    if (refreshToken) {
      await apiRequest('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        retry: false
      });
    }
  } finally {
    clearAdminSession();
  }
}

export function queryString(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) query.set(key, value);
  });
  return query.toString();
}
