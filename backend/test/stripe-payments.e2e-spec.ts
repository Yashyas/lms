import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module.js';
import { auth } from '../src/auth/auth.js';
import { DbPoolService } from '../src/db-pool/db-pool.service.js';
import { GlobalExceptionFilter } from '../src/filters/global-exception.filter.js';

// Load environment variables
try { process.loadEnvFile('.env'); } catch {}
try { process.loadEnvFile('../.env'); } catch {}

process.env.DISABLE_AUTH_RATE_LIMIT = 'true';

describe('Stripe Payments & Test Card Verification Suite', () => {
  let app: INestApplication;
  let db: DbPoolService;
  let stripe: Stripe;

  const timestamp = Date.now();

  // Admin & Instructor
  let adminToken: string;
  let adminUser: { id: string; email: string };

  let instructorToken: string;
  let instructorUser: { id: string; email: string };

  // Students (isolated per test scenario to adhere to endpoint throttler limits)
  let studentAToken: string;
  let studentAUser: { id: string; email: string };

  let studentBToken: string;
  let studentBUser: { id: string; email: string };

  let studentCToken: string;
  let studentCUser: { id: string; email: string };

  // Courses
  let paidCourseId: string;
  let paidCourseTitle: string;
  let freeCourseId: string;
  let paidLessonId: string;

  // Helper to create and authenticate fresh test students
  async function createTestStudent(namePrefix: string) {
    const email = `${namePrefix}_${Date.now()}_${Math.random().toString(36).substring(7)}@test.local`;
    const signUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'StudentPass123!', name: namePrefix });
    return { token: signUp.body.token, user: signUp.body.user };
  }

  // Helper to construct and send signed Stripe webhook requests
  function sendWebhook(payloadObj: any) {
    const payloadStr = JSON.stringify(payloadObj);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: payloadStr,
      secret: process.env.STRIPE_WEBHOOK_SECRET || '',
    });
    return request(app.getHttpServer())
      .post('/payments/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payloadStr);
  }

  beforeAll(async () => {
    console.log('\n=============================================================');
    console.log('💳 STARTING STRIPE TEST CARDS, REFUNDS & ADVERSARIAL SUITE');
    console.log('=============================================================\n');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    db = app.get(DbPoolService);
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2026-10-28.endive',
    });

    // 1. Setup Admin
    const adminEmail = `stripe_admin_${timestamp}@test.local`;
    const adminSignUp = await auth.api.signUpEmail({
      body: { email: adminEmail, password: 'AdminPassword123!', name: 'Stripe Admin' },
    });
    await db.client.user.update({
      where: { id: adminSignUp.user.id },
      data: { role: 'admin' },
    });
    const adminSignIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: adminEmail, password: 'AdminPassword123!' });
    adminToken = adminSignIn.body.token;
    adminUser = adminSignIn.body.user;

    // 2. Setup Instructor
    const instEmail = `stripe_inst_${timestamp}@test.local`;
    await auth.api.signUpEmail({
      body: { email: instEmail, password: 'InstructorPass123!', name: 'Stripe Instructor' },
    });
    await request(app.getHttpServer())
      .post('/users/admin/assign-instructor')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: instEmail });
    const instSignIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: instEmail, password: 'InstructorPass123!' });
    instructorToken = instSignIn.body.token;
    instructorUser = instSignIn.body.user;

    // 3. Setup Students
    const sA = await createTestStudent('student_a');
    studentAToken = sA.token;
    studentAUser = sA.user;

    const sB = await createTestStudent('student_b');
    studentBToken = sB.token;
    studentBUser = sB.user;

    const sC = await createTestStudent('student_c');
    studentCToken = sC.token;
    studentCUser = sC.user;

    // 4. Create Paid Course ($29.99 = 2999 cents)
    paidCourseTitle = `Advanced Distributed Systems ${timestamp}`;
    const paidCourseRes = await request(app.getHttpServer())
      .post('/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: paidCourseTitle,
        description: 'Complete distributed systems and database internals course',
        price: 2999,
      });
    paidCourseId = paidCourseRes.body.id;

    // Create Free Preview Lesson and Paid Lesson BEFORE publishing
    await request(app.getHttpServer())
      .post(`/lessons/courses/${paidCourseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Preview: Distributed Transactions',
        content: 'Free preview content',
        isFree: true,
        position: 1,
      });

    const paidLessonRes = await request(app.getHttpServer())
      .post(`/lessons/courses/${paidCourseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Core: Raft Consensus Implementation',
        content: 'Protected paid content',
        isFree: false,
        position: 2,
      });
    paidLessonId = paidLessonRes.body.id;

    // Now publish the course (has 2 lessons, meets validation rule)
    await request(app.getHttpServer())
      .patch(`/courses/publish/${paidCourseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);

    // Create Free Course ($0) for validation guards
    const freeCourseRes = await request(app.getHttpServer())
      .post('/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: `Free Open Source Overview ${timestamp}`,
        description: 'Free course intro',
        price: 0,
      });
    freeCourseId = freeCourseRes.body.id;

    // Add lesson to free course and publish
    await request(app.getHttpServer())
      .post(`/lessons/courses/${freeCourseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Free Welcome Module',
        isFree: true,
        position: 1,
      });

    await request(app.getHttpServer())
      .patch(`/courses/publish/${freeCourseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);

    console.log(`✅ Fixtures ready. Paid Course: "${paidCourseTitle}" ($29.99), Free Course ID: ${freeCourseId}\n`);
  }, 60000);

  afterAll(async () => {
    if (paidCourseId) {
      await db.client.course.deleteMany({ where: { id: { in: [paidCourseId, freeCourseId] } } }).catch(() => {});
    }
    await app.close().catch(() => {});
    console.log('✅ Payments test suite cleaned up');
  });

  // =========================================================================
  // 1. SUCCESSFUL STRIPE TEST CARD PURCHASE (pm_card_visa / 4242 4242 4242 4242)
  // =========================================================================
  it('1. SUCCESS: Real Stripe Purchase using test card (pm_card_visa)', async () => {
    console.log('--- TEST 1: Successful Purchase with Visa Test Card (4242...) ---');

    // Student A creates Checkout Session
    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .expect(201);

    expect(checkoutRes.body).toHaveProperty('sessionId');
    expect(checkoutRes.body).toHaveProperty('url');
    const sessionId = checkoutRes.body.sessionId;

    // Verify DB pending payment
    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: sessionId },
    });
    expect(pendingPayment).toBeDefined();
    expect(pendingPayment?.status).toBe('PENDING');
    expect(pendingPayment?.price).toBe(2999);

    // Charge Stripe test mode using successful test card 'pm_card_visa'
    const realPaymentIntent = await stripe.paymentIntents.create({
      amount: 2999,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        paymentId: pendingPayment!.id,
        courseId: paidCourseId,
        userId: studentAUser.id,
      },
    });
    expect(realPaymentIntent.status).toBe('succeeded');
    console.log(`   Real Stripe Test PaymentIntent succeeded: ${realPaymentIntent.id}`);

    // Deliver Authoritative Stripe Webhook: checkout.session.completed
    const webhookRes = await sendWebhook({
      id: `evt_success_${timestamp}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          payment_status: 'paid',
          amount_total: 2999,
          currency: 'usd',
          payment_intent: realPaymentIntent.id,
          metadata: {
            paymentId: pendingPayment!.id,
            courseId: paidCourseId,
            userId: studentAUser.id,
          },
        },
      },
    }).expect(201);
    expect(webhookRes.body.received).toBe(true);

    // Verify Payment Transitioned to COMPLETED and Enrollment created
    const completedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(completedPayment?.status).toBe('COMPLETED');
    expect(completedPayment?.stripePaymentIntentId).toBe(realPaymentIntent.id);
    expect(completedPayment?.enrollmentId).toBeDefined();

    // Verify Student A is enrolled and can access paid lesson
    const statusRes = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .expect(200);
    expect(statusRes.body.isEnrolled).toBe(true);

    await request(app.getHttpServer())
      .get(`/lessons/${paidLessonId}`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .expect(200);

    // Verify Payment History reflects receipt
    const historyRes = await request(app.getHttpServer())
      .get('/payments/my-history')
      .set('Authorization', `Bearer ${studentAToken}`)
      .expect(200);
    const receipt = historyRes.body.find((p: any) => p.id === completedPayment!.id);
    expect(receipt).toBeDefined();
    expect(receipt.price).toBe(2999);
    console.log('   ✅ Purchase completed successfully; student enrolled and receipt generated.\n');
  });

  // =========================================================================
  // 2. FAILURE TEST CARD: INSUFFICIENT FUNDS (pm_card_chargeDeclinedInsufficientFunds)
  // =========================================================================
  it('2. FAILURE: Card Declined - Insufficient Funds (pm_card_chargeDeclinedInsufficientFunds)', async () => {
    console.log('--- TEST 2: Decline Card - Insufficient Funds (4000 0000 0000 9995) ---');

    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentBToken}`)
      .expect(201);
    const sessionId = checkoutRes.body.sessionId;

    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: sessionId },
    });

    // Execute Stripe PaymentIntent with insufficient funds test card
    let failedIntentId = '';
    let declineReason = '';
    try {
      await stripe.paymentIntents.create({
        amount: 2999,
        currency: 'usd',
        payment_method: 'pm_card_chargeDeclinedInsufficientFunds',
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      });
    } catch (err: any) {
      failedIntentId = err.raw?.payment_intent?.id || `pi_declined_${timestamp}`;
      declineReason = err.raw?.payment_intent?.last_payment_error?.message || err.message;
      expect(err.code).toBe('card_declined');
      expect(err.decline_code).toBe('insufficient_funds');
      console.log(`   Stripe rejected charge: [${err.decline_code}] ${declineReason}`);
    }

    // Deliver Stripe Webhook: payment_intent.payment_failed
    await sendWebhook({
      id: `evt_failed_funds_${timestamp}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: failedIntentId,
          last_payment_error: { message: declineReason },
          metadata: { paymentId: pendingPayment!.id },
        },
      },
    }).expect(201);

    // Verify DB Payment is marked FAILED
    const failedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(failedPayment?.status).toBe('FAILED');
    expect(failedPayment?.enrollmentId).toBeNull();

    // Verify Student B was NOT granted enrollment
    const statusRes = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentBToken}`)
      .expect(200);
    expect(statusRes.body.isEnrolled).toBe(false);

    // Verify Student B is blocked from paid lesson
    const blockedRes = await request(app.getHttpServer())
      .get(`/lessons/${paidLessonId}`)
      .set('Authorization', `Bearer ${studentBToken}`);
    expect([403, 404]).toContain(blockedRes.status);
    console.log('   ✅ Insufficient funds handled: Payment marked FAILED, access blocked.\n');
  });

  // =========================================================================
  // 3. FAILURE TEST CARD: GENERIC DECLINE (pm_card_chargeCustomerFail)
  // =========================================================================
  it('3. FAILURE: Card Declined - Generic Decline (pm_card_chargeCustomerFail)', async () => {
    console.log('--- TEST 3: Decline Card - Generic Decline (4000 0000 0000 0002) ---');

    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentBToken}`)
      .expect(201);

    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: checkoutRes.body.sessionId },
    });

    let failedIntentId = '';
    let declineReason = '';
    try {
      await stripe.paymentIntents.create({
        amount: 2999,
        currency: 'usd',
        payment_method: 'pm_card_chargeCustomerFail',
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      });
    } catch (err: any) {
      failedIntentId = err.raw?.payment_intent?.id || `pi_fail_${Date.now()}`;
      declineReason = err.message;
      expect(err.code).toBe('card_declined');
      console.log(`   Stripe rejected charge: [${err.code}] ${declineReason}`);
    }

    await sendWebhook({
      id: `evt_failed_generic_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: failedIntentId,
          last_payment_error: { message: declineReason },
          metadata: { paymentId: pendingPayment!.id },
        },
      },
    }).expect(201);

    const failedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(failedPayment?.status).toBe('FAILED');
    console.log('   ✅ Generic card decline handled: Payment marked FAILED.\n');
  });

  // =========================================================================
  // 4. FAILURE TEST CARD: EXPIRED CARD (pm_card_chargeDeclinedExpiredCard)
  // =========================================================================
  it('4. FAILURE: Card Declined - Expired Card (pm_card_chargeDeclinedExpiredCard)', async () => {
    console.log('--- TEST 4: Decline Card - Expired Card (4000 0000 0000 0069) ---');

    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentBToken}`)
      .expect(201);

    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: checkoutRes.body.sessionId },
    });

    let failedIntentId = '';
    try {
      await stripe.paymentIntents.create({
        amount: 2999,
        currency: 'usd',
        payment_method: 'pm_card_chargeDeclinedExpiredCard',
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      });
    } catch (err: any) {
      failedIntentId = err.raw?.payment_intent?.id || `pi_expired_${Date.now()}`;
      expect(err.code).toBe('expired_card');
      console.log(`   Stripe rejected charge: [${err.code}] ${err.message}`);
    }

    await sendWebhook({
      id: `evt_failed_expired_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: failedIntentId,
          last_payment_error: { message: 'Your card has expired.' },
          metadata: { paymentId: pendingPayment!.id },
        },
      },
    }).expect(201);

    const failedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(failedPayment?.status).toBe('FAILED');
    console.log('   ✅ Expired card handled: Payment marked FAILED.\n');
  });

  // =========================================================================
  // 5. FAILURE TEST CARD: INCORRECT CVC (pm_card_chargeDeclinedIncorrectCvc)
  // =========================================================================
  it('5. FAILURE: Card Declined - Incorrect CVC (pm_card_chargeDeclinedIncorrectCvc)', async () => {
    console.log('--- TEST 5: Decline Card - Incorrect CVC (4000 0000 0000 0127) ---');

    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentCToken}`)
      .expect(201);

    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: checkoutRes.body.sessionId },
    });

    let failedIntentId = '';
    try {
      await stripe.paymentIntents.create({
        amount: 2999,
        currency: 'usd',
        payment_method: 'pm_card_chargeDeclinedIncorrectCvc',
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      });
    } catch (err: any) {
      failedIntentId = err.raw?.payment_intent?.id || `pi_cvc_${Date.now()}`;
      expect(err.code).toBe('incorrect_cvc');
      console.log(`   Stripe rejected charge: [${err.code}] ${err.message}`);
    }

    await sendWebhook({
      id: `evt_failed_cvc_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: failedIntentId,
          last_payment_error: { message: "Your card's security code is incorrect." },
          metadata: { paymentId: pendingPayment!.id },
        },
      },
    }).expect(201);

    const failedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(failedPayment?.status).toBe('FAILED');
    console.log('   ✅ Incorrect CVC handled: Payment marked FAILED.\n');
  });

  // =========================================================================
  // 6. FAILURE: CHECKOUT SESSION EXPIRED (checkout.session.expired)
  // =========================================================================
  it('6. FAILURE: Abandoned Checkout Session Expiration (checkout.session.expired)', async () => {
    console.log('--- TEST 6: Checkout Session Expiration Webhook ---');

    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentCToken}`)
      .expect(201);

    const sessionId = checkoutRes.body.sessionId;
    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: sessionId },
    });

    await sendWebhook({
      id: `evt_expired_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: sessionId,
          metadata: { paymentId: pendingPayment!.id },
        },
      },
    }).expect(201);

    const expiredPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(expiredPayment?.status).toBe('FAILED');
    console.log('   ✅ Abandoned checkout session cleanly marked FAILED.\n');
  });

  // =========================================================================
  // 7. REAL STRIPE REFUND & AUTOMATIC ENROLLMENT REVOCATION (Admin Endpoint)
  // =========================================================================
  it('7. REFUND: Admin Real Stripe Refund via POST /payments/refund/:paymentId', async () => {
    console.log('--- TEST 7: Admin Refund & Revocation Flow ---');

    // Retrieve Student A's completed payment from Test 1
    const completedPayment = await db.client.payment.findFirst({
      where: {
        userId: studentAUser.id,
        courseId: paidCourseId,
        status: 'COMPLETED',
      },
    });
    expect(completedPayment).toBeDefined();
    expect(completedPayment?.stripePaymentIntentId).toBeDefined();

    // Verify Student A is currently enrolled
    const beforeRefundStatus = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .expect(200);
    expect(beforeRefundStatus.body.isEnrolled).toBe(true);

    // Non-Admin attempt to refund -> 403 Forbidden
    await request(app.getHttpServer())
      .post(`/payments/refund/${completedPayment!.id}`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .expect(403);
    console.log('   🛡️ Security: Non-admin student blocked from issuing refund (403)');

    // Admin executes refund via POST /payments/refund/:paymentId
    // Calls real Stripe API: stripe.refunds.create({ payment_intent: payment.stripePaymentIntentId })
    const refundRes = await request(app.getHttpServer())
      .post(`/payments/refund/${completedPayment!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(refundRes.body.success).toBe(true);
    expect(refundRes.body).toHaveProperty('refundId');
    expect(refundRes.body.status).toBe('succeeded');
    console.log(`   💸 Real Stripe Refund Processed: ID ${refundRes.body.refundId} (Status: ${refundRes.body.status})`);

    // Verify DB: Payment status is REFUNDED and enrollmentId is null
    const refundedPayment = await db.client.payment.findUnique({
      where: { id: completedPayment!.id },
    });
    expect(refundedPayment?.status).toBe('REFUNDED');
    expect(refundedPayment?.enrollmentId).toBeNull();

    // Verify Enrollment row is deleted from DB
    const enrollmentInDb = await db.client.enrollment.findUnique({
      where: { userId_courseId: { userId: studentAUser.id, courseId: paidCourseId } },
    });
    expect(enrollmentInDb).toBeNull();

    // Verify Student A status is immediately revoked
    const afterRefundStatus = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .expect(200);
    expect(afterRefundStatus.body.isEnrolled).toBe(false);

    // Verify Student A is immediately blocked from paid lesson
    const blockedLesson = await request(app.getHttpServer())
      .get(`/lessons/${paidLessonId}`)
      .set('Authorization', `Bearer ${studentAToken}`);
    expect([403, 404]).toContain(blockedLesson.status);
    console.log('   ✅ Revocation confirmed: Student un-enrolled, lesson access revoked.\n');
  });

  // =========================================================================
  // 8. STRIPE CHARGE REFUND WEBHOOK (charge.refunded)
  // =========================================================================
  it('8. REFUND: Stripe Webhook Asynchronous Refund (charge.refunded)', async () => {
    console.log('--- TEST 8: Asynchronous charge.refunded Webhook Listener ---');

    // 1. Create and complete a new purchase for Student B
    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentBToken}`)
      .expect(201);

    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: checkoutRes.body.sessionId },
    });

    const realPI = await stripe.paymentIntents.create({
      amount: 2999,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });

    await sendWebhook({
      id: `evt_fulf_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: checkoutRes.body.sessionId,
          payment_status: 'paid',
          amount_total: 2999,
          currency: 'usd',
          payment_intent: realPI.id,
          metadata: {
            paymentId: pendingPayment!.id,
            courseId: paidCourseId,
            userId: studentBUser.id,
          },
        },
      },
    }).expect(201);

    // Confirm Student B is enrolled
    let bStatus = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentBToken}`)
      .expect(200);
    expect(bStatus.body.isEnrolled).toBe(true);

    // 2. Deliver charge.refunded webhook
    await sendWebhook({
      id: `evt_charge_refunded_${Date.now()}`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_test_${Date.now()}`,
          payment_intent: realPI.id,
        },
      },
    }).expect(201);

    // Verify automatic revocation
    const bRefundedPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(bRefundedPayment?.status).toBe('REFUNDED');

    bStatus = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentBToken}`)
      .expect(200);
    expect(bStatus.body.isEnrolled).toBe(false);
    console.log('   ✅ charge.refunded webhook processed: Student B access revoked.\n');
  });

  // =========================================================================
  // 9. ADVERSARIAL ATTACKS & GUARDS (Tampering, Signature, Hijack, Resurrection)
  // =========================================================================
  it('9. ADVERSARIAL: Security Guards against Webhook Tampering & Exploit Scenarios', async () => {
    console.log('--- TEST 9: Adversarial Payment Attacks & Security Invariants ---');

    // A. Forged Webhook Signature (Spoofed Origin)
    const forgedPayload = JSON.stringify({ id: 'evt_fake', type: 'checkout.session.completed' });
    const forgedRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('stripe-signature', 't=123,v1=bad_hash_0000000000000000')
      .set('Content-Type', 'application/json')
      .send(forgedPayload)
      .expect(400);
    expect(forgedRes.body.message).toContain('Webhook validation failed');
    console.log('   🛡️ [BLOCKED] Forged Webhook Signature: Rejected by HMAC validator.');

    // B. Tampered Price Underpayment ($1.00 instead of $29.99)
    const tamperCheckout = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${studentCToken}`)
      .expect(201);

    const tamperPending = await db.client.payment.findFirst({
      where: { stripeSessionId: tamperCheckout.body.sessionId },
    });

    await sendWebhook({
      id: `evt_tamper_underpaid_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: tamperCheckout.body.sessionId,
          payment_status: 'paid',
          amount_total: 100, // Attacker manipulated $1.00 instead of 2999
          currency: 'usd',
          payment_intent: `pi_underpaid_${Date.now()}`,
          metadata: {
            paymentId: tamperPending!.id,
            courseId: paidCourseId,
            userId: studentCUser.id,
          },
        },
      },
    });

    const tamperEnrollment = await db.client.enrollment.findUnique({
      where: { userId_courseId: { userId: studentCUser.id, courseId: paidCourseId } },
    });
    expect(tamperEnrollment).toBeNull();
    console.log('   🛡️ [BLOCKED] Price Underpayment Tampering: Enrollment refused.');

    // C. Currency Unit Tampering (e.g. 2999 JPY instead of 2999 USD)
    await sendWebhook({
      id: `evt_tamper_currency_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: tamperCheckout.body.sessionId,
          payment_status: 'paid',
          amount_total: 2999,
          currency: 'jpy', // Currency mismatch
          payment_intent: `pi_currency_${Date.now()}`,
          metadata: {
            paymentId: tamperPending!.id,
            courseId: paidCourseId,
            userId: studentCUser.id,
          },
        },
      },
    });
    const currencyEnrollment = await db.client.enrollment.findUnique({
      where: { userId_courseId: { userId: studentCUser.id, courseId: paidCourseId } },
    });
    expect(currencyEnrollment).toBeNull();
    console.log('   🛡️ [BLOCKED] Currency Unit Tampering: Currency mismatch caught.');

    // D. Resurrection Guard: Late Webhook After Refund
    const refundedPayment = await db.client.payment.findFirst({
      where: { status: 'REFUNDED', courseId: paidCourseId },
    });
    if (refundedPayment) {
      await sendWebhook({
        id: `evt_resurrect_${Date.now()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: refundedPayment.stripeSessionId || `cs_resurrect_${Date.now()}`,
            payment_status: 'paid',
            amount_total: 2999,
            currency: 'usd',
            payment_intent: `pi_late_${Date.now()}`,
            metadata: {
              paymentId: refundedPayment.id,
              courseId: paidCourseId,
              userId: refundedPayment.userId,
            },
          },
        },
      });

      const reCheck = await db.client.payment.findUnique({ where: { id: refundedPayment.id } });
      expect(reCheck?.status).toBe('REFUNDED');
      console.log('   🛡️ [BLOCKED] Resurrection Attack: Late webhook on refunded payment refused.');
    }

    // E. Prevent Self-Purchase by Instructor
    const selfPurchase = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(400);
    expect(selfPurchase.body.message).toContain('Cannot purchase your own course');
    console.log('   🛡️ [BLOCKED] Self-Purchase Prevention: Instructor purchase blocked.');

    // F. Prevent Checkout on Free Course ($0)
    const freePurchase = await request(app.getHttpServer())
      .post(`/payments/checkout/${freeCourseId}`)
      .set('Authorization', `Bearer ${studentCToken}`)
      .expect(400);
    expect(freePurchase.body.message).toContain('Cannot purchase a free course');
    console.log('   🛡️ [BLOCKED] Free Course Checkout Prevention: Blocked zero-dollar checkout.');

    // G. Prevent Refunding a Non-Completed Payment
    const pendingToRefund = await db.client.payment.findFirst({
      where: { status: 'FAILED' },
    });
    if (pendingToRefund) {
      const invalidRefund = await request(app.getHttpServer())
        .post(`/payments/refund/${pendingToRefund.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(invalidRefund.body.message).toContain('Only completed payments can be refunded');
      console.log('   🛡️ [BLOCKED] Ineligible Refund Guard: Cannot refund FAILED payment.');
    }

    console.log('   ✅ All security invariants and adversarial tests passed successfully.\n');
  });

  // =========================================================================
  // 10. EXTREME RACE CONDITION: Out-of-Order Webhooks (charge.refunded before checkout.session.completed)
  // =========================================================================
  it('10. EXTREME RACE: Out-of-order webhooks - charge.refunded arrives BEFORE checkout.session.completed', async () => {
    console.log('--- TEST 10: Extreme Race Condition (Refund webhook before Completed webhook) ---');

    // 1. Create a fresh test student
    const raceStudent = await createTestStudent('student_race');

    // 2. Student initiates checkout session
    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${paidCourseId}`)
      .set('Authorization', `Bearer ${raceStudent.token}`)
      .expect(201);

    const sessionId = checkoutRes.body.sessionId;
    expect(sessionId).toBeDefined();

    // 3. Verify DB payment record is in PENDING state
    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: sessionId },
    });
    expect(pendingPayment).toBeDefined();
    expect(pendingPayment?.status).toBe('PENDING');
    expect(pendingPayment?.enrollmentId).toBeNull();

    // Verify student is not enrolled yet
    let statusRes = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${raceStudent.token}`)
      .expect(200);
    expect(statusRes.body.isEnrolled).toBe(false);

    // 4. Create confirmed PaymentIntent on Stripe with paymentId in metadata
    const pi = await stripe.paymentIntents.create({
      amount: 2999,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        paymentId: pendingPayment!.id,
        courseId: paidCourseId,
        userId: raceStudent.user.id,
      },
    });

    // 5. SIMULATE RACE CONDITION: charge.refunded arrives FIRST!
    // The LMS has NOT received checkout.session.completed yet.
    console.log('   ⚡ Step 1: Delivering charge.refunded webhook FIRST (prior to completed)...');
    const refundWebhookRes = await sendWebhook({
      id: `evt_race_refund_${Date.now()}`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: `ch_race_${Date.now()}`,
          payment_intent: pi.id,
          amount_refunded: 2999,
        },
      },
    });
    expect(refundWebhookRes.status).toBe(201);

    // Verify DB: payment is marked REFUNDED via metadata lookup fallback
    const paymentAfterRefund = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(paymentAfterRefund?.status).toBe('REFUNDED');
    expect(paymentAfterRefund?.enrollmentId).toBeNull();
    console.log('   ✅ Webhook 1 processed: Payment marked REFUNDED even without prior completion.');

    // 6. SIMULATE RACE CONDITION: checkout.session.completed arrives SECOND!
    console.log('   ⚡ Step 2: Delivering delayed checkout.session.completed webhook SECOND...');
    const completedWebhookRes = await sendWebhook({
      id: `evt_race_completed_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          payment_status: 'paid',
          amount_total: 2999,
          currency: 'usd',
          payment_intent: pi.id,
          metadata: {
            paymentId: pendingPayment!.id,
            courseId: paidCourseId,
            userId: raceStudent.user.id,
          },
        },
      },
    });
    expect(completedWebhookRes.status).toBe(201);

    // 7. ASSERTIONS: Fulfill order must refuse fulfillment because status === REFUNDED!
    const finalPayment = await db.client.payment.findUnique({
      where: { id: pendingPayment!.id },
    });
    expect(finalPayment?.status).toBe('REFUNDED');
    expect(finalPayment?.enrollmentId).toBeNull();

    // Verify NO enrollment was ever created
    const enrollment = await db.client.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: raceStudent.user.id,
          courseId: paidCourseId,
        },
      },
    });
    expect(enrollment).toBeNull();

    // Verify student cannot access the course
    statusRes = await request(app.getHttpServer())
      .get(`/enrollment/status/${paidCourseId}`)
      .set('Authorization', `Bearer ${raceStudent.token}`)
      .expect(200);
    expect(statusRes.body.isEnrolled).toBe(false);

    // Verify student cannot access paid lesson
    await request(app.getHttpServer())
      .get(`/lessons/${paidLessonId}`)
      .set('Authorization', `Bearer ${raceStudent.token}`)
      .expect(404);

    // Verify client verify-session rejects the refunded payment
    const verifyRes = await request(app.getHttpServer())
      .post('/payments/verify-session')
      .set('Authorization', `Bearer ${raceStudent.token}`)
      .send({ sessionId })
      .expect(400);
    expect(verifyRes.body.message).toMatch(/Payment has (not been completed|been refunded or cannot be fulfilled)/);

    console.log('   🛡️ [VERIFIED] User DOES NOT receive free access: late completion refused and enrollment remained null.\n');
  });
});
