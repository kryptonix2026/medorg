import { Request, Response, NextFunction } from "express";

function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error("Error:", err);
  
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || "INTERNAL_ERROR";
  const message = err.message || "Internal server error";
  
  // Don't leak stack traces in production
  const response = process.env.NODE_ENV === "production"
    ? { error: message, code: errorCode }
    : { error: message, code: errorCode, stack: err.stack };
  
  res.status(statusCode).json(response);
}

export default globalErrorHandler;