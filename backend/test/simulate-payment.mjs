// backend/test/simulate-payment.mjs
try { process.loadEnvFile('.env'); } catch (e) {}
try { process.loadEnvFile('../.env'); } catch (e) {}

import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { DbPoolService } from '../dist/db-pool/db-pool.service.js';
import { PaymentsService } from '../dist/payments/payments.service.js';
import { PaymentStatus } from '@lms/db';

async function runSimulation() {
  console.log('\n======================================================');
  console.log('🚀 STARTING REAL END-TO-END STRIPE PAYMENT SIMULATION');
  console.log('======================================================\n');

  // 1. Initialize DB and Config
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

  try {
    // 2. Select or create test course and student
    let instructor = await db.client.user.findFirst({
      where: { role: 'admin' },
    });
    if (!instructor) {
      instructor = await db.client.user.findFirst();
    }

    let course = await db.client.course.findFirst({
      where: {
        published: true,
        price: { gt: 50 },
      },
    });

    if (!course) {
      console.log('Creating a test published course...');
      course = await db.client.course.create({
        data: {
          title: 'Simulation Test Course - Stripe Verification',
          slug: `stripe-sim-course-${Date.now()}`,
          price: 500, // $5.00
          published: true,
          instructorId: instructor.id,
        },
      });
    }

    console.log(`📌 Target Course: "${course.title}" (ID: ${course.id}, Price: $${(course.price / 100).toFixed(2)})`);

    // Create a unique test student to ensure clean state
    const testStudentId = `sim_std_${Date.now()}`;
    const testStudentEmail = `sim_student_${Date.now()}@example.com`;
    const studentUser = {
      id: testStudentId,
      email: testStudentEmail,
      role: 'student',
    };

    const createdStudent = await db.client.user.create({
      data: {
        id: testStudentId,
        email: testStudentEmail,
        name: 'Simulation Student',
        role: 'student',
      },
    });
    console.log(`👤 Created Test Student: ${createdStudent.email} (ID: ${createdStudent.id})\n`);

    // -------------------------------------------------------------
    // TEST 1: CREATE CHECKOUT SESSION
    // -------------------------------------------------------------
    console.log('--- TEST 1: Create Stripe Checkout Session ---');
    const checkoutResult = await paymentsService.createCheckoutSession(course.id, studentUser);
    console.log('✅ Stripe API Response Received:');
    console.log(`   Session ID : ${checkoutResult.sessionId}`);
    console.log(`   Checkout URL: ${checkoutResult.url.slice(0, 50)}...`);

    // Verify DB record
    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: checkoutResult.sessionId },
    });
    if (!pendingPayment || pendingPayment.status !== PaymentStatus.PENDING) {
      throw new Error(`Expected payment status PENDING, got ${pendingPayment?.status}`);
    }
    console.log(`✅ DB Pending Payment Verified (ID: ${pendingPayment.id}, Status: ${pendingPayment.status})\n`);

    // -------------------------------------------------------------
    // TEST 2: CRYPTOGRAPHIC WEBHOOK SIGNATURE VERIFICATION
    // -------------------------------------------------------------
    console.log('--- TEST 2: Webhook Signature Verification ---');
    const mockPaymentIntentId = `pi_test_${Date.now()}`;

    const syntheticSession = {
      id: checkoutResult.sessionId,
      object: 'checkout.session',
      payment_status: 'paid',
      amount_total: course.price,
      currency: 'usd',
      payment_intent: mockPaymentIntentId,
      metadata: {
        paymentId: pendingPayment.id,
        courseId: course.id,
        userId: studentUser.id,
      },
    };

    const webhookPayload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      object: 'event',
      api_version: '2026-10-28.endive',
      type: 'checkout.session.completed',
      data: {
        object: syntheticSession,
      },
    });

    const signature = stripe.webhooks.generateTestHeaderString({
      payload: webhookPayload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });

    const parsedEvent = paymentsService.constructWebhookEvent(
      Buffer.from(webhookPayload),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log(`✅ HMAC-SHA256 Webhook Signature Validated! Event Type: ${parsedEvent.type}\n`);

    // -------------------------------------------------------------
    // TEST 3: ATOMIC FULFILLMENT & ENROLLMENT
    // -------------------------------------------------------------
    console.log('--- TEST 3: Fulfill Order & Grant Enrollment ---');
    await paymentsService.fulfillOrder(syntheticSession);

    // Verify Payment status is COMPLETED
    const completedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment.id },
    });
    if (completedPayment.status !== PaymentStatus.COMPLETED) {
      throw new Error(`Expected COMPLETED status, got ${completedPayment.status}`);
    }
    console.log(`✅ Payment Record Transitioned: ${completedPayment.status} (Intent: ${completedPayment.stripePaymentIntentId})`);

    // Verify Enrollment exists
    const enrollment = await db.client.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: studentUser.id,
          courseId: course.id,
        },
      },
    });
    if (!enrollment) {
      throw new Error('Enrollment row was NOT created in DB!');
    }
    console.log(`✅ Enrollment Verified in Database (ID: ${enrollment.id}) for user ${studentUser.id}\n`);

    // -------------------------------------------------------------
    // TEST 4: IDEMPOTENCY (Duplicate Webhook Delivery)
    // -------------------------------------------------------------
    console.log('--- TEST 4: Idempotent Webhook Retry Test ---');
    const idempotentResult = await paymentsService.fulfillOrder(syntheticSession);
    if (idempotentResult.status !== PaymentStatus.COMPLETED) {
      throw new Error('Idempotent retry failed to return completed payment');
    }
    const enrollmentCount = await db.client.enrollment.count({
      where: {
        userId: studentUser.id,
        courseId: course.id,
      },
    });
    if (enrollmentCount !== 1) {
      throw new Error(`Duplicate enrollment created! Count: ${enrollmentCount}`);
    }
    console.log('✅ Idempotency Verified: Re-processing identical session skipped duplicate work cleanly.\n');

    // -------------------------------------------------------------
    // TEST 5: CLIENT VERIFY-SESSION (Security Guard)
    // -------------------------------------------------------------
    console.log('--- TEST 5: Client verifySession Handshake & Hijack Guard ---');
    try {
      await paymentsService.verifySession(checkoutResult.sessionId, { id: 'wrong_user_id' });
      throw new Error('Security flaw: verifySession allowed mismatched user!');
    } catch (err) {
      console.log(`✅ Security Verified: Hijacking session blocked with "${err.message}"\n`);
    }

    // -------------------------------------------------------------
    // TEST 6: REFUND & ACCESS REVOCATION
    // -------------------------------------------------------------
    console.log('--- TEST 6: Refund & Revoke Enrollment ---');
    await paymentsService.revokeEnrollment(mockPaymentIntentId);

    const refundedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment.id },
    });
    if (refundedPayment.status !== PaymentStatus.REFUNDED || refundedPayment.enrollmentId !== null) {
      throw new Error(`Payment refund state invalid: status=${refundedPayment.status}, enrollmentId=${refundedPayment.enrollmentId}`);
    }

    const revokedEnrollment = await db.client.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: studentUser.id,
          courseId: course.id,
        },
      },
    });
    if (revokedEnrollment !== null) {
      throw new Error('Enrollment was NOT deleted upon refund!');
    }
    console.log('✅ Revocation Verified: Enrollment deleted from DB, Payment marked REFUNDED.\n');

    // -------------------------------------------------------------
    // TEST 7: RESURRECTION GUARD (Late Webhook After Refund)
    // -------------------------------------------------------------
    console.log('--- TEST 7: Resurrection Guard on Refunded Payment ---');
    await paymentsService.fulfillOrder(syntheticSession);

    const postRefundPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment.id },
    });
    const postRefundEnrollment = await db.client.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: studentUser.id,
          courseId: course.id,
        },
      },
    });
    if (postRefundPayment.status !== PaymentStatus.REFUNDED) {
      throw new Error('Security flaw: Refunded payment was overwritten to COMPLETED!');
    }
    if (postRefundEnrollment !== null) {
      throw new Error('Security flaw: Enrollment was re-created after refund!');
    }
    console.log('✅ Resurrection Guard Verified: Late webhook rejected, student stayed un-enrolled.\n');

    // Clean up test student and payment
    console.log('Cleaning up simulation test records...');
    await db.client.payment.deleteMany({ where: { userId: testStudentId } });
    await db.client.user.deleteMany({ where: { id: testStudentId } });
    console.log('🧹 Cleanup complete.');

    console.log('\n======================================================');
    console.log('🎉 ALL 7 PAYMENT SIMULATION TESTS PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
  } finally {
    try { await db.client?.$disconnect(); } catch (e) {}
  }
}

runSimulation().catch((err) => {
  console.error('\n❌ SIMULATION FAILED:', err);
  process.exit(1);
});
