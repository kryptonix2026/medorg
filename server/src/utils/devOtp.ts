import { config } from "../config";

const devOtpMap = new Map<string, string>();

export function recordDevOtp(email: string, otp: string): void {
  if (config.nodeEnv !== "production" && config.otpDevLog) {
    devOtpMap.set(email.trim().toLowerCase(), otp.trim());
  }
}

export function getDevOtp(email: string): string | undefined {
  if (config.nodeEnv !== "production" && config.otpDevLog) {
    return devOtpMap.get(email.trim().toLowerCase());
  }
  return undefined;
}
