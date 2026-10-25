import "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userType: "PATIENT" | "DOCTOR";
        userId: string;
        token: string;
      };
    }
  }
}

export {};
