export interface User {
  id: string;
  medOrgId: string;
  name: string;
  email: string;
  dateOfBirth: string;
  nationalIdLast4: string;
}

export interface Doctor {
  id: string;
  doctorId: string;
  name: string;
  email: string;
  medicalLicenseNumber: string;
  hospitalName: string;
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  doctorId: string;
  recordType: "REPORT" | "PRESCRIPTION";
  title: string;
  description: string;
  originalFileName: string;
  storedFileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  patient?: User;
  doctor?: Doctor;
}

export interface AccessRequest {
  id: string;
  patientId: string;
  doctorId: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "REVOKED";
  requestedAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  accessDuration: string;
  patient?: User;
  doctor?: Doctor;
}

export interface Notification {
  id: string;
  userType: "PATIENT" | "DOCTOR";
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User | Doctor;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
  success?: boolean;
}

export interface DatabaseSummary {
  disabled: boolean;
  counts?: {
    patients: number;
    doctors: number;
    records: number;
    accessRequests: number;
    sessions: number;
  };
  patients?: any[];
  doctors?: any[];
  records?: any[];
  accessRequests?: any[];
  sessions?: any[];
}

export interface AiStatus {
  configured: boolean;
  modelConfigured: boolean;
  model: string | null;
  provider?: string;
}

export interface AiSummarizeResponse {
  success: boolean;
  summary: string;
  recordCount: number;
  recordsUsed?: number;
  recordsSkipped?: Array<{ title: string; reason: string }>;
}

export interface ActiveGrantSummary {
  requestId: string;
  patientMedOrgId: string;
  status: string;
  expiresAt: string | null;
}

export interface LiveStatusResponse {
  userType: "PATIENT" | "DOCTOR";
  unreadNotifications: number;
  accessVersion: string;
  pendingRequestsCount?: number;
  activeGrants?: ActiveGrantSummary[];
}