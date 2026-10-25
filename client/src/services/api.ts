const API_URL = import.meta.env.VITE_API_URL || "/api";

// Session token storage
const TOKEN_KEY = "medorg_token";
const USER_KEY = "medorg_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getUser<T = any>(): T | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setUser(user: any): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Core fetch wrapper
async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Don't set Content-Type for FormData
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  // Handle 401 - session expired
  if (response.status === 401) {
    clearToken();
    window.location.hash = "#/user/login";
    throw new Error("Session expired. Please log in again.");
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data as T;
}

// Auth API
export const authApi = {
  patientSendOtp: (email: string, purpose: string, name?: string, nationalId?: string, dateOfBirth?: string) =>
    request("/auth/patient/send-otp", {
      method: "POST",
      body: JSON.stringify({ email, purpose, name, nationalId, dateOfBirth }),
    }),

  patientVerifyOtp: (email: string, purpose: string, otp: string, name?: string, nationalId?: string, dateOfBirth?: string) =>
    request("/auth/patient/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, purpose, otp, name, nationalId, dateOfBirth }),
    }),

  doctorSendOtp: (email: string, purpose: string, name?: string, licenseNumber?: string, hospitalName?: string) =>
    request("/auth/doctor/send-otp", {
      method: "POST",
      body: JSON.stringify({ email, purpose, name, licenseNumber, hospitalName }),
    }),

  doctorVerifyOtp: (email: string, purpose: string, otp: string, name?: string, licenseNumber?: string, hospitalName?: string) =>
    request("/auth/doctor/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, purpose, otp, name, licenseNumber, hospitalName }),
    }),

  licenseStatus: (license: string) =>
    request(`/auth/doctor/license-status?license=${encodeURIComponent(license)}`),

  logout: () =>
    request("/auth/patient/logout", { method: "POST" }),
};

// Access API
export const accessApi = {
  request: (patientMedOrgId: string) =>
    request("/access/request", {
      method: "POST",
      body: JSON.stringify({ patientMedOrgId }),
    }),

  doctorMine: () =>
    request("/access/doctor/mine"),

  patient: () =>
    request("/access/patient"),

  active: () =>
    request("/access/active"),

  approveStart: (requestId: string, duration: string) =>
    request("/access/approve/start", {
      method: "POST",
      body: JSON.stringify({ requestId, duration }),
    }),

  approve: (requestId: string, otp: string) =>
    request(`/access/${requestId}/approve`, {
      method: "POST",
      body: JSON.stringify({ otp }),
    }),

  deny: (requestId: string) =>
    request(`/access/${requestId}/deny`, { method: "POST" }),

  revoke: (requestId: string) =>
    request(`/access/${requestId}/revoke`, { method: "POST" }),
};

// Patients & Records API
export const recordsApi = {
  lookup: (medOrgId: string) =>
    request("/patients/lookup", {
      method: "POST",
      body: JSON.stringify({ medOrgId }),
    }),

  timeline: (patientId: string) =>
    request(`/patients/${patientId}/timeline`),

  upload: (formData: FormData) =>
    request("/records/upload", {
      method: "POST",
      body: formData,
    }),

  getRecord: (recordId: string) =>
    request(`/records/${recordId}`),

  viewRecord: (recordId: string) =>
    request(`/records/${recordId}/view`),

  downloadRecord: (recordId: string) =>
    request(`/records/${recordId}/download`),
};

// AI API
export const aiApi = {
  status: () =>
    request("/ai/status"),

  summarize: (patientId: string) =>
    request("/ai/summarize", {
      method: "POST",
      body: JSON.stringify({ patientId }),
    }),
};

// Notifications API
export const notificationsApi = {
  get: () =>
    request("/notifications"),

  count: () =>
    request("/notifications/count"),

  markRead: (id: string) =>
    request(`/notifications/${id}/read`, { method: "POST" }),

  markAllRead: () =>
    request("/notifications/read-all", { method: "POST" }),
};

// Live API
export const liveApi = {
  status: () =>
    request("/live/status"),
};

// Database API
export const databaseApi = {
  summary: () =>
    request("/database/summary"),

  reset: () =>
    request("/database/reset", { method: "POST" }),
};

// Health check with retry
export async function checkHealth(maxRetries = 3): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  return false;
}