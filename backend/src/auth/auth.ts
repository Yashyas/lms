import { betterAuth } from 'better-auth';
import { zenstackAdapter } from '@zenstackhq/better-auth';
import { schema, ZenStackClient, PostgresDialect } from '@lms/db';
import { Pool } from 'pg';
import { admin, bearer, openAPI } from 'better-auth/plugins';
import { rawDbClient } from '../db-pool/db-pool.service.js';


export const auth = betterAuth({
    database: zenstackAdapter(rawDbClient as any, {
        provider: 'postgresql',
    }),

    secret: process.env.BETTER_AUTH_SECRET,

    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

    session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
        cookieCache: {
            enabled: true,
            maxAge: 10 * 60,
        }
    },

    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
    },

    rateLimit: {
        enabled: true,
        window: 60,
        max: 100,

        customRules: {
            "/sign-in/email": {
                window: 60,
                max: 5,
            },
            "/sign-up/email": {
                window: 60 * 60,
                max: 5,
            }
        },
    },
    plugins: [
        bearer(),
        admin({
            defaultRole: 'student',
            adminRoles: ['admin'],
        }),
        openAPI(),
    ],
    trustedOrigins: [
        process.env.FRONTEND_URL || "http://localhost:3001", 'http://localhost:3000',
    ],

});
