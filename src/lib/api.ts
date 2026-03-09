/**
 * FortiNest API Client
 * Connects frontend to FastAPI backend.
 * Falls back to mock mode when the backend is unreachable.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ─── Token Management ───────────────────────────────────────────
let authToken: string | null = localStorage.getItem('fortinest_token');
let activeHouseId: string | null = localStorage.getItem('fortinest_active_house_id');

export const setToken = (token: string | null) => {
  authToken = token;
  if (token) localStorage.setItem('fortinest_token', token);
  else localStorage.removeItem('fortinest_token');
};

export const getToken = () => authToken;

export const setActiveHouseId = (houseId: string | null) => {
  activeHouseId = houseId;
  if (houseId) localStorage.setItem('fortinest_active_house_id', houseId);
  else localStorage.removeItem('fortinest_active_house_id');
};

export const getActiveHouseId = () => activeHouseId;

// ─── Backend reachability ───────────────────────────────────────
let backendAvailable: boolean | null = null;

async function isBackendUp(): Promise<boolean> {
  if (backendAvailable !== null) return backendAvailable;
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    backendAvailable = res.ok;
  } catch {
    backendAvailable = false;
  }
  // Re-check every 30s
  setTimeout(() => { backendAvailable = null; }, 30000);
  return backendAvailable;
}

// ─── Base Fetch ─────────────────────────────────────────────────
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const up = await isBackendUp();
  if (!up) throw new Error('__MOCK__');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  if (activeHouseId) {
    headers['X-House-Id'] = activeHouseId;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }

  return res.json();
}

// ─── Types ──────────────────────────────────────────────────────
export interface ApiUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'admin' | 'member';
  is_primary_admin: boolean;
  status: 'active' | 'blocked' | 'pending';
  house_id: string | null;
  house_code?: string | null;
  joined_at: string;
}

export interface ApiAccessLog {
  id: string;
  user_id: string;
  user_name: string;
  timestamp: string;
  action: string;
  method: string;
  result: 'success' | 'failed' | 'alert';
  ip_address: string | null;
  device_id: string | null;
  category?: string;
}

export interface ApiCredential {
  id: string;
  type: 'rfid' | 'fingerprint' | 'keypad' | 'otp';
  registered: boolean;
  registered_at: string | null;
  has_credential_value: boolean;
}

export interface ApiAuthMethod {
  id: string;
  type: 'rfid' | 'fingerprint' | 'keypad' | 'otp';
  enabled: boolean;
  priority: number;
  has_credential: boolean;
}

export interface ApiJoinRequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  house_code: string;
  requested_at: string;
  status: string;
}

export interface ApiOTP {
  status: string;
  otp: string;
  expires_in: string;
}

export interface ApiESPStatus {
  status: string;
  message: string;
}

export interface ApiUnlockSession {
  id: string;
  user_id: string;
  status: 'pending' | 'authenticating' | 'success' | 'failed' | 'expired' | 'cancelled';
  auth_methods: string[];
  current_method: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

// ─── Auth ───────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<{ access_token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signup: (data: {
    full_name: string;
    email: string;
    password: string;
    phone?: string;
    address?: string;
    dob?: string;
    role: 'admin' | 'member';
    house_code?: string;
  }) =>
    apiFetch<{ access_token: string; user: ApiUser; house_code?: string; pending_approval?: boolean }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  me: () => apiFetch<ApiUser>('/auth/me'),
};

// ─── Users ──────────────────────────────────────────────────────
export const usersApi = {
  getHouseUsers: () => apiFetch<ApiUser[]>('/users/'),

  updateProfile: (data: { full_name?: string; phone?: string; address?: string; dob?: string }) =>
    apiFetch<{ message: string }>('/users/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  changeEmail: (newEmail: string, password: string) =>
    apiFetch<{ message: string }>('/users/change-email', {
      method: 'PATCH',
      body: JSON.stringify({ new_email: newEmail, password }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ message: string }>('/users/change-password', {
      method: 'PATCH',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  transferPrimaryAdmin: (targetUserId: string) =>
    apiFetch<{ message: string }>(`/users/transfer-primary-admin?target_user_id=${targetUserId}`, {
      method: 'POST',
    }),

  getJoinRequests: () => apiFetch<ApiJoinRequest[]>('/users/join-requests'),

  approveJoinRequest: (requestId: string) =>
    apiFetch<{ message: string }>(`/users/join-requests/${requestId}/approve`, { method: 'POST' }),

  rejectJoinRequest: (requestId: string) =>
    apiFetch<{ message: string }>(`/users/join-requests/${requestId}/reject`, { method: 'POST' }),

  updateRole: (userId: string, role: 'admin' | 'member') =>
    apiFetch<{ message: string }>(`/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  updateStatus: (userId: string, status: 'active' | 'blocked') =>
    apiFetch<{ message: string }>(`/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  removeUser: (userId: string) =>
    apiFetch<{ message: string }>(`/users/${userId}`, { method: 'DELETE' }),

  selfBlock: () =>
    apiFetch<{ message: string }>('/users/self-block', { method: 'POST' }),
};

// ─── Logs ───────────────────────────────────────────────────────
export const logsApi = {
  getLogs: (filter?: string, page = 1, limit = 20, category?: string, search?: string) => {
    const params = new URLSearchParams();
    if (filter && filter !== 'all') params.set('filter', filter);
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return apiFetch<ApiAccessLog[]>(`/logs/?${params}`);
  },
};

// ─── Credentials ────────────────────────────────────────────────
export const credentialsApi = {
  getAll: () => apiFetch<ApiCredential[]>('/credentials/'),

  register: (type: string, data?: string, credentialValue?: string) =>
    apiFetch<ApiCredential>(`/credentials/${type}/register`, {
      method: 'POST',
      body: JSON.stringify({ type, data, credential_value: credentialValue }),
    }),

  unregister: (type: string) =>
    apiFetch<{ message: string }>(`/credentials/${type}`, { method: 'DELETE' }),

  getAuthMethods: () => apiFetch<ApiAuthMethod[]>('/credentials/auth-methods'),

  updateAuthMethods: (methods: { type: string; enabled: boolean; priority: number }[]) =>
    apiFetch<ApiAuthMethod[]>('/credentials/auth-methods', {
      method: 'PUT',
      body: JSON.stringify(methods),
    }),
};

// ─── ESP32 / Hardware ───────────────────────────────────────────
export const espApi = {
  generateOTP: () => apiFetch<ApiOTP>('/api/otp/generate'),

  getStatus: () => apiFetch<ApiESPStatus>('/api/esp/status'),

  emergencyUnlock: () =>
    apiFetch<{ status: string; action: string }>('/api/esp/emergency-unlock', { method: 'POST' }),

  requestUnlock: () =>
    apiFetch<ApiUnlockSession>('/api/unlock/request', { method: 'POST' }),

  getUnlockSession: (sessionId: string) =>
    apiFetch<ApiUnlockSession>(`/api/unlock/${sessionId}`),

  cancelUnlock: (sessionId: string) =>
    apiFetch<{ message: string }>(`/api/unlock/${sessionId}/cancel`, { method: 'POST' }),

  getLockdownStatus: () =>
    apiFetch<{ lockdown: boolean; lockdown_by: string | null; lockdown_at: string | null }>('/api/house/lockdown'),

  setLockdown: (active: boolean) =>
    apiFetch<{ message: string; lockdown: boolean }>('/api/house/lockdown', {
      method: 'POST',
      body: JSON.stringify({ active }),
    }),
};

// ─── Houses ─────────────────────────────────────────────────────
export const housesApi = {
  create: (name: string) =>
    apiFetch<{ house_id: string; house_code: string; house_name: string }>('/houses/create', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  join: (houseCode: string) =>
    apiFetch<{ house_id: string; house_name: string; house_code: string; status: string; message: string }>('/houses/join', {
      method: 'POST',
      body: JSON.stringify({ house_code: houseCode }),
    }),
};
