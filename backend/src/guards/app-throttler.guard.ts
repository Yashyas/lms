import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
    protected async getTracker(req: Record<string, any>): Promise<string> {
        // if authenticated use better auth 
        const userId = req.user?.id || req.session?.user?.id;
        if (userId) {
            return `user_${userId}`;
        }
        // Fallback to Bearer token if guard runs before AuthGuard attaches user
        const authHeader = req.headers?.authorization;
        if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            return `token_${authHeader.slice(7)}`;
        }
        // Otherwise, fallback to client IP
        const forwarded = req.headers?.['x-forwarded-for'];
        const clientIp = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || (req.ips?.length ? req.ips[0] : req.ip);
        return `ip_${clientIp || 'unknown'}`;
    }
}