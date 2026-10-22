import { betterAuth } from 'better-auth';
import { zenstackAdapter } from '@zenstackhq/better-auth';
import { schema, ZenStackClient, PostgresDialect } from '@lms/db';
import { Pool } from 'pg';
import { admin, bearer } from 'better-auth/plugins';

try { process.loadEnvFile('.env'); } catch { }
try { process.loadEnvFile('../.env'); } catch { }

// For CLI generation and runtime, it needs a ZenStackClient instance
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({ pool }),
});

export const auth = betterAuth({
    database: zenstackAdapter(client as any, {
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
                max: 5, // 5 login attempt per minute
            },
            "/sign-up/email": {
                window: 60 * 60,
                max: 5,  //3 signup per hour
            }
        },
    },
    // any plugins you add in the future (e.g. organization, twoFactor, etc.)
    plugins: [
        bearer(),
        admin({
            defaultRole: 'student',
            adminRoles: ['admin'],
        }),
    ],
    trustedOrigins: [
        process.env.FRONTEND_URL || "http://localhost:3001", 'http://localhost:3000',
    ],

});
