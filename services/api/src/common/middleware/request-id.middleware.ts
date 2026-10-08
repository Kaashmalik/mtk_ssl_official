import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

export interface RequestWithId extends Request {
  requestId?: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction) {
    const headerId = req.header("x-request-id");
    const requestId = headerId?.trim() || randomUUID();

    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    next();
  }
}