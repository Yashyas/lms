import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message: string | object = 'Internal server error';

        // 1. Standard NestJS HttpExceptions (400, 401, 403, 404, etc.)
        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res = exception.getResponse();
            message = typeof res === 'object' ? (res as any).message || res : res;
        }
        // 2. ZenStack Policy Rejection (403 Forbidden)
        else if ((exception as any)?.reason === 'rejected-by-policy') {
            status = HttpStatus.FORBIDDEN;
            message = 'Operation is rejected by security policies';
            this.logger.warn(
                `[Security] Policy rejection on ${request.method} ${request.url} by user: ${(exception as any).message}`,
            );
        }
        // 3. ZenStack / Prisma Record Not Found (404 Not Found)
        else if ((exception as any)?.reason === 'not-found') {
            status = HttpStatus.NOT_FOUND;
            message = (exception as any).message || 'Record not found';
        }
        // 4. ZenStack Invalid Input (400 Bad Request)
        else if ((exception as any)?.reason === 'invalid-input') {
            status = HttpStatus.BAD_REQUEST;
            message = (exception as any).message || 'Invalid input provided';
        }
        // 5. ZenStack Database Query Errors (PostgreSQL constraints)
        else if ((exception as any)?.reason === 'db-query-error') {
            const dbErrorCode = (exception as any)?.dbErrorCode;

            // Postgres 23505 = Unique Violation (Duplicate slug, duplicate enrollment, etc.)
            if (dbErrorCode === '23505') {
                status = HttpStatus.CONFLICT;
                message = 'A record with this unique identifier or relationship already exists';
            }
            // Postgres 23503 = Foreign Key Violation (Referencing a course or user that does not exist)
            else if (dbErrorCode === '23503') {
                status = HttpStatus.BAD_REQUEST;
                message = 'Referenced related record does not exist';
            }
            // Other database engine errors -> 500 without leaking raw SQL
            else {
                status = HttpStatus.INTERNAL_SERVER_ERROR;
                message = 'Database operation failed';
                this.logger.error(
                    `DB Query Error on ${request.method} ${request.url}: ${(exception as any).dbErrorMessage || (exception as any).message}`,
                );
            }
        }
        // 6. All other unhandled exceptions (Mask internal stack traces from attackers)
        else {
            this.logger.error(
                `Unhandled Exception on [${request.method}] ${request.url}`,
                exception instanceof Error ? exception.stack : exception,
            );
        }

        // Return consistent JSON structure across the entire LMS
        response.status(status).json({
            statusCode: status,
            message,
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}