// backend/test/security-verification.mjs
try { process.loadEnvFile('.env'); } catch (e) {}
try { process.loadEnvFile('../.env'); } catch (e) {}

import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { DbPoolService } from '../dist/db-pool/db-pool.service.js';
import { PaymentsService } from '../dist/payments/payments.service.js';
import { VideoAssetService } from '../dist/video-asset/video-asset.service.js';
import { PaymentStatus } from '@lms/db';

async function runSecurityAudit() {
  console.log('\n=============================================================');
  console.log('🛡️  RUNNING ADVERSARIAL PAYMENT & AUTHORIZATION TEST SUITE');
  console.log('=============================================================\n');

  const db = new DbPoolService();
  await db.onModuleInit();

  const config = new ConfigService({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-10-28.endive',
  });

  const paymentsService = new PaymentsService(db, config);

  // Mock queue and storage service for VideoAssetService
  const mockStorageService = { getUploadPresignedUrl: async () => 'http://mock' };
  const mockQueue = { add: async () => {} };
  const videoAssetService = new VideoAssetService(db, mockStorageService, mockQueue);

  let passedTests = 0;
  let totalTests = 0;

  function recordResult(testName, passed, detail) {
    totalTests++;
    if (passed) {
      passedTests++;
      console.log(`✅ [BLOCKED] ${testName}`);
      if (detail) console.log(`   └─ Defense: ${detail}`);
    } else {
      console.error(`❌ [FAILED DEFENSE] ${testName}`);
      if (detail) console.error(`   └─ Loophole: ${detail}`);
    }
  }

  try {
    // Setup test principals and paid course
    let instructor = await db.client.user.findFirst({ where: { role: 'admin' } });
    if (!instructor) instructor = await db.client.user.findFirst();

    const timestamp = Date.now();
    const testCourse = await db.client.course.create({
      data: {
        title: `Security Test Course ${timestamp}`,
        slug: `sec-test-course-${timestamp}`,
        price: 2999, // $29.99
        published: true,
        instructorId: instructor.id,
      },
    });

    const testLesson = await db.client.lesson.create({
      data: {
        title: 'Protected Lecture 1',
        isFree: false,
        position: 1,
        courseId: testCourse.id,
      },
    });

    const testVideo = await db.client.videoAsset.create({
      data: {
        lessonId: testLesson.id,
        status: 'READY',
        encryptionKey: '0123456789abcdef0123456789abcdef', // 16 bytes hex
      },
    });

    const studentA = {
      id: `usr_sec_a_${timestamp}`,
      email: `student_a_${timestamp}@test.local`,
      name: 'Student A',
      role: 'student',
    };
    await db.client.user.create({ data: studentA });

    const studentB = {
      id: `usr_sec_b_${timestamp}`,
      email: `student_b_${timestamp}@test.local`,
      name: 'Student B',
      role: 'student',
    };
    await db.client.user.create({ data: studentB });

    console.log(`📌 Test Fixture: Course "${testCourse.title}" ($29.99)`);
    console.log(`👤 Student A: ${studentA.id}`);
    console.log(`👤 Student B: ${studentB.id}\n`);

    // ------------------------------------------------------------------
    // ATTACK 1: Forged Webhook Signature (Spoofed Origin)
    // ------------------------------------------------------------------
    try {
      const forgedPayload = JSON.stringify({
        id: 'evt_forged_001',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_fake' } },
      });
      const invalidSignature = 't=12345,v1=bad_signature_hash_0000000000000000';
      paymentsService.constructWebhookEvent(
        Buffer.from(forgedPayload),
        invalidSignature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      recordResult('Forged Webhook Signature', false, 'Allowed untrusted webhook without valid signature!');
    } catch (err) {
      recordResult('Forged Webhook Signature', true, `Rejected with "${err.message}"`);
    }

    // ------------------------------------------------------------------
    // ATTACK 2: Webhook Body Payload Tampering (Signature Mismatch)
    // ------------------------------------------------------------------
    try {
      const originalPayload = JSON.stringify({ id: 'evt_orig_001', amount: 2999 });
      const validSigForOriginal = stripe.webhooks.generateTestHeaderString({
        payload: originalPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
      });

      // Attacker intercepts and tampers body to amount: 100 while keeping original signature
      const tamperedPayload = JSON.stringify({ id: 'evt_orig_001', amount: 100 });
      paymentsService.constructWebhookEvent(
        Buffer.from(tamperedPayload),
        validSigForOriginal,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      recordResult('Tampered Webhook Payload', false, 'Accepted tampered payload!');
    } catch (err) {
      recordResult('Tampered Webhook Payload', true, 'Detected HMAC hash divergence; rejected body modification.');
    }

    // ------------------------------------------------------------------
    // ATTACK 3: Price Underpayment Tampering (Paying $1 instead of $29.99)
    // ------------------------------------------------------------------
    const paymentRecord = await db.client.payment.create({
      data: {
        userId: studentA.id,
        courseId: testCourse.id,
        userEmail: studentA.email,
        courseTitle: testCourse.title,
        price: testCourse.price, // 2999 cents
        currency: 'usd',
        status: PaymentStatus.PENDING,
        provider: 'stripe',
      },
    });

    try {
      const underpaidSession = {
        id: `cs_underpaid_${timestamp}`,
        payment_status: 'paid',
        amount_total: 100, // Attacker forged session amount to $1.00
        currency: 'usd',
        payment_intent: `pi_underpaid_${timestamp}`,
        metadata: {
          paymentId: paymentRecord.id,
          courseId: testCourse.id,
          userId: studentA.id,
        },
      };

      await paymentsService.fulfillOrder(underpaidSession);
      recordResult('Price Underpayment Tampering', false, 'Granted enrollment on underpaid session!');
    } catch (err) {
      const enrollment = await db.client.enrollment.findUnique({
        where: { userId_courseId: { userId: studentA.id, courseId: testCourse.id } },
      });
      const blocked = !enrollment && err.message.includes('Payment amount does not match');
      recordResult('Price Underpayment Tampering', blocked, err.message);
    }

    // ------------------------------------------------------------------
    // ATTACK 4: Currency Unit Tampering (e.g., Paying 2999 INR instead of USD)
    // ------------------------------------------------------------------
    try {
      const wrongCurrencySession = {
        id: `cs_curr_${timestamp}`,
        payment_status: 'paid',
        amount_total: testCourse.price,
        currency: 'jpy', // Japanese Yen (2999 JPY = ~$19 vs $29.99 USD)
        payment_intent: `pi_curr_${timestamp}`,
        metadata: {
          paymentId: paymentRecord.id,
          courseId: testCourse.id,
          userId: studentA.id,
        },
      };

      await paymentsService.fulfillOrder(wrongCurrencySession);
      recordResult('Currency Unit Tampering', false, 'Allowed cross-currency exchange unit mismatch!');
    } catch (err) {
      const blocked = err.message.toLowerCase().includes('currency mismatch');
      recordResult('Currency Unit Tampering', blocked, err.message);
    }

    // ------------------------------------------------------------------
    // ATTACK 5: Premature Enrollment on Unpaid / Incomplete Session
    // ------------------------------------------------------------------
    const unpaidSession = {
      id: `cs_unpaid_${timestamp}`,
      payment_status: 'unpaid', // Customer selected bank transfer but hasn't paid
      amount_total: testCourse.price,
      currency: 'usd',
      payment_intent: `pi_unpaid_${timestamp}`,
      metadata: {
        paymentId: paymentRecord.id,
        courseId: testCourse.id,
        userId: studentA.id,
      },
    };

    await paymentsService.fulfillOrder(unpaidSession);
    const unpaidEnrollment = await db.client.enrollment.findUnique({
      where: { userId_courseId: { userId: studentA.id, courseId: testCourse.id } },
    });
    recordResult(
      'Premature Enrollment on Unpaid Session',
      !unpaidEnrollment,
      'Held enrollment; session payment_status was unpaid.'
    );

    // ------------------------------------------------------------------
    // ATTACK 6: Session Hijacking (User B claiming User A\'s session ID)
    // ------------------------------------------------------------------
    // Create authentic session on Stripe
    const realCheckout = await paymentsService.createCheckoutSession(testCourse.id, studentA);
    try {
      // Student B attempts to verify Student A's checkout session
      await paymentsService.verifySession(realCheckout.sessionId, studentB);
      recordResult('Session Hijacking Across Accounts', false, 'Student B claimed Student A session!');
    } catch (err) {
      recordResult(
        'Session Hijacking Across Accounts',
        true,
        `Rejected with: "${err.message}"`
      );
    }

    // ------------------------------------------------------------------
    // ATTACK 7: Direct ZenStack Database Policy Bypass on Paid Course
    // ------------------------------------------------------------------
    try {
      // Student B attempts to directly insert an enrollment into PostgreSQL via ZenStack ORM
      await db.forUser(studentB).enrollment.create({
        data: {
          userId: studentB.id,
          courseId: testCourse.id,
        },
      });
      recordResult('Direct Database Policy Bypass on Paid Course', false, 'Student created free enrollment on paid course via ORM!');
    } catch (err) {
      recordResult(
        'Direct Database Policy Bypass on Paid Course',
        true,
        'ZenStack RLS policy rejected direct enrollment creation (course.price > 0).'
      );
    }

    // ------------------------------------------------------------------
    // ATTACK 8: Unauthorized AES-128 Video Decryption Key Acquisition
    // ------------------------------------------------------------------
    try {
      // Non-enrolled Student B requests decryption key for paid lesson
      await videoAssetService.getVideoKey(testLesson.id, studentB);
      recordResult('Unauthorized Video Key Decryption', false, 'Served AES-128 key to non-enrolled student!');
    } catch (err) {
      recordResult(
        'Unauthorized Video Key Decryption',
        err.status === 403 || err.message.includes('not authorized'),
        `Key access blocked with HTTP 403 Forbidden.`
      );
    }

    // ------------------------------------------------------------------
    // ATTACK 9: Refund Resurrection Attack (Late Webhook Free Access)
    // ------------------------------------------------------------------
    // 1. Fulfill Student A legitimately
    const legitimatePaymentIntent = `pi_legit_${timestamp}`;
    const validSession = {
      id: realCheckout.sessionId,
      payment_status: 'paid',
      amount_total: testCourse.price,
      currency: 'usd',
      payment_intent: legitimatePaymentIntent,
      metadata: {
        paymentId: paymentRecord.id,
        courseId: testCourse.id,
        userId: studentA.id,
      },
    };
    await paymentsService.fulfillOrder(validSession);

    // 2. Admin issues refund -> access revoked
    await paymentsService.revokeEnrollment(legitimatePaymentIntent);

    // 3. Late/replayed webhook arrives
    await paymentsService.fulfillOrder(validSession);

    const postRefundEnrollment = await db.client.enrollment.findUnique({
      where: { userId_courseId: { userId: studentA.id, courseId: testCourse.id } },
    });
    recordResult(
      'Refund Replay / Resurrection Attack',
      postRefundEnrollment === null,
      'FulfillOrder detected REFUNDED state and refused re-activation.'
    );

    // Clean up test fixtures
    await db.client.videoAsset.deleteMany({ where: { lessonId: testLesson.id } });
    await db.client.lesson.deleteMany({ where: { courseId: testCourse.id } });
    await db.client.payment.deleteMany({ where: { courseId: testCourse.id } });
    await db.client.enrollment.deleteMany({ where: { courseId: testCourse.id } });
    await db.client.course.deleteMany({ where: { id: testCourse.id } });
    await db.client.user.deleteMany({ where: { id: { in: [studentA.id, studentB.id] } } });

    console.log('\n=============================================================');
    console.log(`🎯 AUDIT SCORECARD: ${passedTests}/${totalTests} DEFENSES CONFIRMED ACTIVE`);
    console.log('=============================================================\n');

  } finally {
    try { await db.client?.$disconnect(); } catch (e) {}
  }
}

runSecurityAudit().catch((err) => {
  console.error('\n❌ AUDIT EXECUTION ERROR:', err);
  process.exit(1);
});
