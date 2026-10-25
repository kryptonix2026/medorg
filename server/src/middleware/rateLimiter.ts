import { Request, Response, NextFunction } from "express";

// Rate limiting disabled per project requirements

function noop(req: Request, res: Response, next: NextFunction) {
  next();
}

export const limiter = noop;
export const otpLimiter = noop;
export const authLimiter = noop;