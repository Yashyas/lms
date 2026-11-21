import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import Stripe from 'stripe';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { AppModule } from '../src/app.module.js';
import { auth } from '../src/auth/auth.js';
import { DbPoolService } from '../src/db-pool/db-pool.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { GlobalExceptionFilter } from '../src/filters/global-exception.filter.js';

// Ensure environment variables are loaded
try { process.loadEnvFile('.env'); } catch {}
try { process.loadEnvFile('../.env'); } catch {}

// Disable rate limits for test environment
process.env.DISABLE_AUTH_RATE_LIMIT = 'true';

describe('Comprehensive LMS E2E Lifecycle (Student, Instructor, Admin)', () => {
  let app: INestApplication;
  let db: DbPoolService;
  let storage: StorageService;
  let stripe: Stripe;

  const timestamp = Date.now();
  const smallPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const testVideoPath = `/tmp/lms-test-video-${timestamp}.mp4`;
  let smallVideoBuffer: Buffer;

  // Principals and tokens
  let adminToken: string;
  let adminUser: { id: string; email: string; name: string };

  let instructorToken: string;
  let instructorUser: { id: string; email: string; name: string };

  let studentToken: string;
  let studentUser: { id: string; email: string; name: string };

  let troublemakerUser: { id: string; email: string };
  let troublemakerToken: string;

  // Created entities
  let courseId: string;
  let courseSlug: string;
  let lesson1Id: string; // Free preview lesson
  let lesson2Id: string; // Paid lesson with video
  let enrollmentId: string;
  let paymentId: string;

  beforeAll(async () => {
    console.log('\n=============================================================');
    console.log('🚀 INITIALIZING LMS FULL LIFECYCLE E2E TEST SUITE');
    console.log('=============================================================\n');

    // 1. Generate small real MP4 video with video and audio tracks
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=10 -f lavfi -i sine=frequency=1000:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac "${testVideoPath}"`,
      { stdio: 'ignore' },
    );
    smallVideoBuffer = fs.readFileSync(testVideoPath);
    console.log(`📦 Generated test MP4 video (${smallVideoBuffer.length} bytes) at ${testVideoPath}`);

    // 2. Initialize Nest testing module
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
    storage = app.get(StorageService);

    stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2026-10-28.endive',
    });

    console.log('✅ NestJS application, database pool, storage, and Stripe initialized\n');
  }, 60000);

  afterAll(async () => {
    console.log('\n=============================================================');
    console.log('🧹 TEARDOWN & CLEANUP');
    console.log('=============================================================');

    // Remove local temp video
    if (fs.existsSync(testVideoPath)) {
      fs.unlinkSync(testVideoPath);
      console.log(`🗑️ Removed local video file: ${testVideoPath}`);
    }

    // Clean up S3 video chunks for lesson2 if any
    if (lesson2Id) {
      await storage.deleteVideoChunks(`hls/${lesson2Id}/`).catch(() => {});
    }

    await app.close().catch(() => {});
    console.log('✅ Application and database connections closed cleanly\n');
  });

  // =========================================================================
  // 1. ROOT & HEALTH ENDPOINTS
  // =========================================================================
  it('1. GET / - Health and database connectivity', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toContain('ZenStack is connected to the backend');
    console.log('✅ 1. Health check: backend connected to PostgreSQL & ZenStack');
  });

  // =========================================================================
  // 2. USER REGISTRATION & ROLE ELEVATION
  // =========================================================================
  it('2. User Registration & Setup (Admin, Instructor candidate, Student)', async () => {
    // A. Create and elevate Admin
    const adminEmail = `e2e_admin_${timestamp}@test.local`;
    const adminSignUp = await auth.api.signUpEmail({
      body: { email: adminEmail, password: 'AdminPassword123!', name: 'Platform Admin' },
    });
    // Promote user directly in DB so they have admin privileges
    await db.client.user.update({
      where: { id: adminSignUp.user.id },
      data: { role: 'admin' },
    });
    // Sign in to retrieve token with admin role
    const adminSignIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: adminEmail, password: 'AdminPassword123!' })
      .expect(200);

    adminToken = adminSignIn.body.token;
    adminUser = adminSignIn.body.user;
    expect(adminUser.role).toBe('admin');
    console.log(`👤 Admin created & authenticated: ${adminUser.email} (Role: ${adminUser.role})`);

    // B. Create Instructor candidate (registers as default student)
    const instructorEmail = `e2e_instructor_${timestamp}@test.local`;
    const instSignUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: instructorEmail, password: 'InstructorPass123!', name: 'Dr. Jane Instructor' })
      .expect(200);

    expect(instSignUp.body.user.role).toBe('student');

    // Admin promotes instructor candidate via POST /users/admin/assign-instructor
    const assignRes = await request(app.getHttpServer())
      .post('/users/admin/assign-instructor')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: instructorEmail })
      .expect(201);

    expect(assignRes.body.user.role).toBe('instructor');
    console.log(`🎓 Admin elevated candidate to instructor: ${instructorEmail}`);

    // Instructor signs in to get instructor session token
    const instSignIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: instructorEmail, password: 'InstructorPass123!' })
      .expect(200);

    instructorToken = instSignIn.body.token;
    instructorUser = instSignIn.body.user;
    expect(instructorUser.role).toBe('instructor');

    // C. Create Real User (Student)
    const studentEmail = `e2e_student_${timestamp}@test.local`;
    const studentSignUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: studentEmail, password: 'StudentPass123!', name: 'Alex Learner' })
      .expect(200);

    studentToken = studentSignUp.body.token;
    studentUser = studentSignUp.body.user;
    expect(studentUser.role).toBe('student');
    console.log(`🎒 Real Student registered & authenticated: ${studentUser.email} (Role: ${studentUser.role})`);

    // Verify GET /me session endpoint
    const meRes = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(meRes.body.message).toBe('You are authenticated');
    expect(meRes.body.user.id).toBe(studentUser.id);
  });

  // =========================================================================
  // 3. PROFILE MANAGEMENT & S3 AVATAR UPLOADS
  // =========================================================================
  it('3. Profile Management & S3 Avatar Upload Lifecycle', async () => {
    // A. Student Avatar Presigned URL
    const studentAvatarDto = {
      fileName: 'alex-avatar.png',
      contentType: 'image/png',
      fileSize: smallPngBuffer.length,
    };
    const avatarUrlRes = await request(app.getHttpServer())
      .post('/users/avatar-upload-url')
      .set('Authorization', `Bearer ${studentToken}`)
      .send(studentAvatarDto)
      .expect(201);

    expect(avatarUrlRes.body).toHaveProperty('uploadUrl');
    expect(avatarUrlRes.body).toHaveProperty('publicUrl');
    expect(avatarUrlRes.body).toHaveProperty('key');

    // B. Direct S3 Upload via Presigned URL (using fetch PUT)
    const uploadRes = await fetch(avatarUrlRes.body.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(smallPngBuffer.length),
      },
      body: smallPngBuffer,
    });
    expect(uploadRes.status).toBe(200);
    console.log('📤 Student avatar binary uploaded to Garage S3 via presigned PUT');

    // C. Update Student Profile with uploaded avatar and bio
    const updateStudentRes = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        name: 'Alex The Dedicated Learner',
        headline: 'Aspiring Cloud & Distributed Systems Engineer',
        bio: 'Passionate about NestJS, ZenStack, and resilient microservices.',
        image: avatarUrlRes.body.publicUrl,
      })
      .expect(200);

    expect(updateStudentRes.body.name).toBe('Alex The Dedicated Learner');
    expect(updateStudentRes.body.image).toBe(avatarUrlRes.body.publicUrl);

    // Verify GET /users/me
    const meProfile = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(meProfile.body.headline).toContain('Aspiring Cloud');

    // D. Instructor Profile & Public Instructor View
    const instAvatarDto = {
      fileName: 'dr-jane.png',
      contentType: 'image/png',
      fileSize: smallPngBuffer.length,
    };
    const instAvatarUrl = await request(app.getHttpServer())
      .post('/users/avatar-upload-url')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send(instAvatarDto)
      .expect(201);

    await fetch(instAvatarUrl.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: smallPngBuffer,
    });

    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        name: 'Dr. Jane Turing',
        headline: 'Distinguished Systems Architect & Educator',
        bio: 'Over 15 years designing distributed architectures and mentoring developers.',
        image: instAvatarUrl.body.publicUrl,
      })
      .expect(200);

    // Public view: GET /users/instructors/:id
    const publicInst = await request(app.getHttpServer())
      .get(`/users/instructors/${instructorUser.id}`)
      .expect(200);
    expect(publicInst.body.name).toBe('Dr. Jane Turing');
    expect(publicInst.body.role).toBe('instructor');
    console.log(`✅ Instructor profile updated & verified via public endpoint: ${publicInst.body.name}`);
  });

  // =========================================================================
  // 4. INSTRUCTOR COURSE CREATION & THUMBNAIL UPLOAD
  // =========================================================================
  it('4. Instructor Course Creation, S3 Thumbnail Upload & Management', async () => {
    // A. Create Course
    const courseDto = {
      title: `Cloud Native Microservices Architecture ${timestamp}`,
      description: 'Master production-grade backend engineering with NestJS, S3, Redis, and Stripe.',
      price: 2499, // $24.99 USD in cents
    };

    const createCourseRes = await request(app.getHttpServer())
      .post('/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send(courseDto)
      .expect(201);

    courseId = createCourseRes.body.id;
    courseSlug = createCourseRes.body.slug;
    expect(createCourseRes.body.published).toBe(false);
    expect(createCourseRes.body.price).toBe(2499);
    console.log(`📚 Draft Course created: "${createCourseRes.body.title}" (ID: ${courseId})`);

    // B. Get Presigned S3 URL for Course Thumbnail
    const thumbDto = {
      fileName: 'course-cover.png',
      contentType: 'image/png',
      fileSize: smallPngBuffer.length,
    };

    const thumbUrlRes = await request(app.getHttpServer())
      .post(`/courses/${courseId}/thumbnail-upload-url`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send(thumbDto)
      .expect(201);

    expect(thumbUrlRes.body).toHaveProperty('uploadUrl');
    expect(thumbUrlRes.body).toHaveProperty('publicUrl');

    // C. Upload Thumbnail to S3
    const putThumbRes = await fetch(thumbUrlRes.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: smallPngBuffer,
    });
    expect(putThumbRes.status).toBe(200);

    // D. Update Course with Thumbnail URL
    const updateCourseRes = await request(app.getHttpServer())
      .patch(`/courses/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        thumbnail: thumbUrlRes.body.publicUrl,
        description: 'Comprehensive curriculum updated with real cloud-native architecture.',
      })
      .expect(200);

    expect(updateCourseRes.body.thumbnail).toBe(thumbUrlRes.body.publicUrl);
    console.log('🖼️ Course thumbnail uploaded to Garage S3 and attached to course');

    // E. Instructor lists their courses: GET /courses/instructor/courses
    const instCourses = await request(app.getHttpServer())
      .get('/courses/instructor/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);

    expect(Array.isArray(instCourses.body)).toBe(true);
    const foundCourse = instCourses.body.find((c: any) => c.id === courseId);
    expect(foundCourse).toBeDefined();

    // F. Get Course by ID: GET /courses/:id
    const singleCourse = await request(app.getHttpServer())
      .get(`/courses/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);
    expect(singleCourse.body.id).toBe(courseId);
  });

  // =========================================================================
  // 5. LESSON CREATION, REORDERING & S3 VIDEO UPLOAD + TRANSCODING
  // =========================================================================
  it('5. Lesson Creation, Reordering & Video Upload Lifecycle', async () => {
    // A. Create Lesson 1: Free Preview
    const lesson1Res = await request(app.getHttpServer())
      .post(`/lessons/courses/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Lesson 1: Introduction & Architecture Overview',
        content: 'Overview of multi-tier distributed architecture and security boundaries.',
        isFree: true,
        position: 1,
      })
      .expect(201);

    lesson1Id = lesson1Res.body.id;
    expect(lesson1Res.body.isFree).toBe(true);
    console.log(`📖 Free preview lesson created (ID: ${lesson1Id})`);

    // B. Create Lesson 2: Paid Content
    const lesson2Res = await request(app.getHttpServer())
      .post(`/lessons/courses/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Lesson 2: Deep Dive into ZenStack Policies & Cryptographic HLS',
        content: 'Comprehensive walkthrough of authorization, row-level policies, and AES-128 keys.',
        isFree: false,
        position: 2,
      })
      .expect(201);

    lesson2Id = lesson2Res.body.id;
    expect(lesson2Res.body.isFree).toBe(false);
    console.log(`🔒 Paid core lesson created (ID: ${lesson2Id})`);

    // C. Update Lesson: PATCH /lessons/:id
    const updateLessonRes = await request(app.getHttpServer())
      .patch(`/lessons/${lesson1Id}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        title: 'Lesson 1: Welcome & Architectural Blueprint (Enhanced)',
      })
      .expect(200);
    expect(updateLessonRes.body.title).toContain('Enhanced');

    // D. Reorder Lessons: PUT /lessons/reorder
    const reorderRes = await request(app.getHttpServer())
      .put('/lessons/reorder')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ lessonIds: [lesson2Id, lesson1Id] })
      .expect(200);

    // Restore original order
    await request(app.getHttpServer())
      .put('/lessons/reorder')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ lessonIds: [lesson1Id, lesson2Id] })
      .expect(200);
    console.log('🔄 Lesson reordering verified & restored');

    // E. S3 Video Upload for Lesson 2
    const videoUploadDto = {
      lessonId: lesson2Id,
      fileName: 'lecture2-production.mp4',
      contentType: 'video/mp4',
    };

    const videoUrlRes = await request(app.getHttpServer())
      .post('/video-asset/upload-url')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send(videoUploadDto)
      .expect(201);

    expect(videoUrlRes.body).toHaveProperty('uploadUrl');
    expect(videoUrlRes.body).toHaveProperty('key');

    // Direct S3 Upload of real MP4 video via presigned URL
    const uploadVideoRes = await fetch(videoUrlRes.body.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(smallVideoBuffer.length),
      },
      body: smallVideoBuffer,
    });
    expect(uploadVideoRes.status).toBe(200);
    console.log('📹 Real MP4 video uploaded to Garage S3 bucket via presigned PUT');

    // F. Mark Upload Complete -> Queues BullMQ Transcoding Job
    const completeRes = await request(app.getHttpServer())
      .patch(`/video-asset/${lesson2Id}/upload-complete`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);

    expect(completeRes.body.status).toBe('PROCESSING');
    console.log('⚙️ Video upload marked complete; BullMQ transcode processor triggered');

    // Poll for transcode completion (typically < 1s for 29KB video)
    let isReady = false;
    for (let i = 0; i < 20; i++) {
      const asset = await db.client.videoAsset.findUnique({
        where: { lessonId: lesson2Id },
      });
      if (asset?.status === 'READY') {
        isReady = true;
        console.log(`🎬 Transcoding completed! Status: READY, AES Encryption Key generated (${asset.encryptionKey ? 'Present' : 'None'})`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(isReady).toBe(true);

    // G. Publish Course: PATCH /courses/publish/:id
    const publishRes = await request(app.getHttpServer())
      .patch(`/courses/publish/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);

    expect(publishRes.body.published).toBe(true);
    console.log(`🚀 Course published to public catalog (Slug: ${courseSlug})`);
  });

  // =========================================================================
  // 6. PUBLIC BROWSING & AUTHORIZATION BOUNDARIES
  // =========================================================================
  it('6. Public Catalog Browsing & Strict Student Authorization Checks', async () => {
    // A. Public course catalog: GET /courses (Anonymous)
    const catalogRes = await request(app.getHttpServer()).get('/courses').expect(200);
    const inCatalog = catalogRes.body.find((c: any) => c.id === courseId);
    expect(inCatalog).toBeDefined();
    expect(inCatalog._count.lessons).toBe(2);

    // B. Public course details by slug: GET /courses/slug/:slug
    const slugRes = await request(app.getHttpServer())
      .get(`/courses/slug/${courseSlug}`)
      .expect(200);
    expect(slugRes.body.slug).toBe(courseSlug);
    expect(slugRes.body.instructor.name).toBe('Dr. Jane Turing');

    // C. Student accesses Free Lesson 1 -> 200 OK
    const freeLessonRes = await request(app.getHttpServer())
      .get(`/lessons/${lesson1Id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(freeLessonRes.body.id).toBe(lesson1Id);
    console.log('✅ Student permitted access to Free Preview Lesson 1');

    // D. Student attempts to access Paid Lesson 2 BEFORE enrollment -> ZenStack rejects (404/403)
    const paidLessonRes = await request(app.getHttpServer())
      .get(`/lessons/${lesson2Id}`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect([403, 404]).toContain(paidLessonRes.status);
    console.log(`🛡️ ZenStack Authorization Guard blocked un-enrolled access to Lesson 2 (HTTP ${paidLessonRes.status})`);

    // E. Student attempts direct enrollment in a paid course ($24.99) -> Rejected
    const directEnrollRes = await request(app.getHttpServer())
      .post(`/enrollment/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(400);
    expect(directEnrollRes.body.message).toContain('requires payment');

    // F. Verify Enrollment status before payment: GET /enrollment/status/:courseId
    const statusBefore = await request(app.getHttpServer())
      .get(`/enrollment/status/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(statusBefore.body.isEnrolled).toBe(false);
  });

  // =========================================================================
  // 7. STRIPE PAYMENT LIFECYCLE & AUTHORITATIVE WEBHOOK FULFILLMENT
  // =========================================================================
  it('7. Stripe Checkout Creation, Webhook Fulfillment & Verification', async () => {
    // A. Create Stripe Checkout Session
    const checkoutRes = await request(app.getHttpServer())
      .post(`/payments/checkout/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(201);

    expect(checkoutRes.body).toHaveProperty('sessionId');
    expect(checkoutRes.body).toHaveProperty('url');
    const sessionId = checkoutRes.body.sessionId;
    console.log(`💳 Stripe Checkout session initiated (Session ID: ${sessionId})`);

    // Verify Pending Payment in DB
    const pendingPayment = await db.client.payment.findFirst({
      where: { stripeSessionId: sessionId },
    });
    expect(pendingPayment).toBeDefined();
    expect(pendingPayment?.status).toBe('PENDING');
    paymentId = pendingPayment!.id;

    // B. Simulate Stripe Webhook: checkout.session.completed
    const webhookPayload = JSON.stringify({
      id: `evt_test_${timestamp}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 2499,
          currency: 'usd',
          payment_intent: `pi_test_${timestamp}`,
          metadata: {
            paymentId,
            courseId,
            userId: studentUser.id,
          },
        },
      },
    });

    const signature = stripe.webhooks.generateTestHeaderString({
      payload: webhookPayload,
      secret: process.env.STRIPE_WEBHOOK_SECRET || '',
    });

    const webhookRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(webhookPayload)
      .expect(201);

    expect(webhookRes.body.received).toBe(true);
    console.log('⚡ Stripe signed webhook delivered & processed: payment fulfilled');

    // C. Verify DB state transition: Payment COMPLETED and Enrollment created
    const fulfilledPayment = await db.client.payment.findUnique({
      where: { id: paymentId },
    });
    expect(fulfilledPayment?.status).toBe('COMPLETED');
    expect(fulfilledPayment?.enrollmentId).toBeDefined();
    enrollmentId = fulfilledPayment!.enrollmentId!;

    // D. Immediate UI redirect verification: POST /payments/verify-session
    // In test environment, verifySession calls stripe.retrieve, which would check test stripe session.
    // Instead of external network wait, we verify student's receipts and enrollment:
    const myPayments = await request(app.getHttpServer())
      .get('/payments/my-history')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(Array.isArray(myPayments.body)).toBe(true);
    const receipt = myPayments.body.find((p: any) => p.id === paymentId);
    expect(receipt).toBeDefined();
    expect(receipt.price).toBe(2499);
    console.log(`🧾 Payment receipt verified in student history: $${(receipt.price / 100).toFixed(2)}`);

    // E. Verify Student Enrollment Status is now ACTIVE
    const statusAfter = await request(app.getHttpServer())
      .get(`/enrollment/status/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(statusAfter.body.isEnrolled).toBe(true);

    // F. Verify Student's Enrolled Courses: GET /enrollment/mine
    const myEnrollments = await request(app.getHttpServer())
      .get('/enrollment/mine')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(myEnrollments.body.some((e: any) => e.course.id === courseId)).toBe(true);

    // G. Instructor & Admin views for Course Payments & Enrollments
    const instCoursePayments = await request(app.getHttpServer())
      .get(`/payments/course/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);
    expect(instCoursePayments.body.length).toBeGreaterThan(0);

    const instCourseEnrollments = await request(app.getHttpServer())
      .get(`/enrollment/course/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);
    expect(instCourseEnrollments.body.length).toBeGreaterThan(0);
    console.log(`👥 Instructor course roster & payments verified: ${instCourseEnrollments.body.length} enrolled student(s)`);
  });

  // =========================================================================
  // 8. STUDENT LEARNING JOURNEY, VIDEO KEY DELIVERY & PROGRESS TRACKING
  // =========================================================================
  it('8. Student Learning Journey, Cryptographic Key Delivery & Progress Tracking', async () => {
    // A. Student accesses Paid Lesson 2 AFTER enrollment -> 200 OK!
    const paidLessonAccess = await request(app.getHttpServer())
      .get(`/lessons/${lesson2Id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(paidLessonAccess.body.id).toBe(lesson2Id);
    console.log('🔓 Enrolled student granted full access to protected Lesson 2');

    // B. Secure AES-128 Key Delivery: GET /video-asset/:lessonId/key
    const keyRes = await request(app.getHttpServer())
      .get(`/video-asset/${lesson2Id}/key`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(keyRes.headers['content-type']).toBe('application/octet-stream');
    expect(keyRes.body).toBeInstanceOf(Buffer);
    expect(keyRes.body.length).toBe(16); // Strict 128-bit key
    console.log(`🔑 Secure 16-byte AES-128 decryption key received by enrolled student (${keyRes.body.length} bytes)`);

    // C. Record Initial Video Heartbeat: POST /lesson-progress/heartbeat/:lessonId
    const heartbeat1 = await request(app.getHttpServer())
      .post(`/lesson-progress/heartbeat/${lesson2Id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ lastPlayedSecond: 30, duration: 120 })
      .expect(201);

    expect(heartbeat1.body.lastPlayedSeconds).toBe(30);
    expect(heartbeat1.body.completed).toBe(false);

    // Verify progress query: GET /lesson-progress/:lessonId
    const progressRes = await request(app.getHttpServer())
      .get(`/lesson-progress/${lesson2Id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(progressRes.body.lastPlayedSeconds).toBe(30);

    // D. Heartbeat crossing 90% threshold -> Auto-completion
    const heartbeat2 = await request(app.getHttpServer())
      .post(`/lesson-progress/heartbeat/${lesson2Id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ lastPlayedSecond: 110, duration: 120 }) // 110/120 = 91.6% >= 90%
      .expect(201);

    expect(heartbeat2.body.completed).toBe(true);
    expect(heartbeat2.body.completedAt).toBeDefined();
    console.log('🎯 Video heartbeat crossed 90% completion threshold; lesson auto-marked completed');

    // E. Manually Toggle Lesson 1 Completion: PATCH /lesson-progress/:lessonId/complete
    const toggleRes = await request(app.getHttpServer())
      .patch(`/lesson-progress/${lesson1Id}/complete`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(toggleRes.body.completed).toBe(true);

    // F. Course-wide Progress Summary: GET /lesson-progress/course/:courseId/progress
    const courseProgress = await request(app.getHttpServer())
      .get(`/lesson-progress/course/${courseId}/progress`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    expect(courseProgress.body.totalLessons).toBe(2);
    expect(courseProgress.body.completedLessons).toBe(2);
    expect(courseProgress.body.percentage).toBe(100);
    expect(courseProgress.body.isCompleted).toBe(true);
    console.log(`🏆 Course completion progress: 100% (${courseProgress.body.completedLessons}/${courseProgress.body.totalLessons} lessons completed)`);
  });

  // =========================================================================
  // 9. ADMIN GOVERNANCE, METRICS & USER MODERATION
  // =========================================================================
  it('9. Platform Admin Governance, Platform Metrics & Moderation', async () => {
    // A. Platform Metrics: GET /admin/stats
    const statsRes = await request(app.getHttpServer())
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(statsRes.body).toHaveProperty('totalStudents');
    expect(statsRes.body).toHaveProperty('totalInstructors');
    expect(statsRes.body).toHaveProperty('totalPublishedCourses');
    expect(statsRes.body).toHaveProperty('totalEnrollments');
    expect(statsRes.body).toHaveProperty('grossRevenuePaise');
    expect(statsRes.body.totalPublishedCourses).toBeGreaterThanOrEqual(1);
    expect(statsRes.body.grossRevenuePaise).toBeGreaterThanOrEqual(2499);
    console.log(
      `📊 Admin platform metrics: ${statsRes.body.totalStudents} students, ${statsRes.body.totalInstructors} instructors, Gross Revenue: $${(statsRes.body.grossRevenuePaise / 100).toFixed(2)}`,
    );

    // B. Search and Paginate Users: GET /admin/users
    const usersListRes = await request(app.getHttpServer())
      .get('/admin/users?role=student&status=active&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(usersListRes.body).toHaveProperty('items');
    expect(usersListRes.body).toHaveProperty('meta');
    expect(usersListRes.body.meta).toHaveProperty('total');
    expect(Array.isArray(usersListRes.body.items)).toBe(true);

    // C. User Moderation: Ban and Unban lifecycle
    const offenderEmail = `troublemaker_${timestamp}@test.local`;
    const offenderSignUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: offenderEmail, password: 'OffenderPass123!', name: 'Troll User' })
      .expect(200);

    const offenderId = offenderSignUp.body.user.id;
    troublemakerToken = offenderSignUp.body.token;

    // Admin bans user: PATCH /admin/users/:id/ban
    const banRes = await request(app.getHttpServer())
      .patch(`/admin/users/${offenderId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        banReason: 'Severe violation of community standards (harassment and spam)',
        banExpiresIn: 86400, // 24 hours in seconds
      })
      .expect(200);

    expect(banRes.body.user.banned).toBe(true);
    expect(banRes.body.user.banReason).toContain('violation of community standards');
    console.log(`🚫 Admin moderation: banned disruptive user ${offenderEmail}`);

    // Verify banned user is blocked on authenticated endpoints
    const bannedCheck = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${troublemakerToken}`);
    // Better-auth returns 401/403 for banned sessions
    expect([401, 403]).toContain(bannedCheck.status);
    console.log(`🛡️ Banned user successfully rejected with HTTP ${bannedCheck.status}`);

    // Admin unbans user: PATCH /admin/users/:id/unban
    const unbanRes = await request(app.getHttpServer())
      .patch(`/admin/users/${offenderId}/unban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(unbanRes.body.user.banned).toBe(false);
    console.log(`✅ Admin moderation: successfully unbanned user ${offenderEmail}`);
  });

  // =========================================================================
  // 10. CLEANUP & DELETION ENDPOINTS
  // =========================================================================
  it('10. Teardown: Unenrollment, Lesson Deletion & Course Deletion', async () => {
    // A. Student Unenrollment on Paid Course without refund is blocked (Business Invariant)
    const blockedUnenroll = await request(app.getHttpServer())
      .delete(`/enrollment/${enrollmentId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(400);
    expect(blockedUnenroll.body.message).toContain('Cannot unenroll from a purchased course');
    console.log('🛡️ Business invariant verified: Student cannot self-unenroll from purchased course');

    // Admin possesses authority to unenroll/remove enrollment: DELETE /enrollment/:id
    const adminUnenrollRes = await request(app.getHttpServer())
      .delete(`/enrollment/${enrollmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminUnenrollRes.body.message).toContain('successfully');
    console.log(`🗑️ Admin un-enrolled student from course`);

    // B. Instructor Deletes Lesson 1: DELETE /lessons/:id
    const deleteLessonRes = await request(app.getHttpServer())
      .delete(`/lessons/${lesson1Id}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);
    console.log(`🗑️ Lesson 1 deleted by instructor`);

    // C. Instructor Deletes Course: DELETE /courses/:id
    const deleteCourseRes = await request(app.getHttpServer())
      .delete(`/courses/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);
    console.log(`🗑️ Course deleted by instructor (Cascade deleted remaining lesson & assets)`);

    // Verify course is gone: GET /courses/:id -> 404
    await request(app.getHttpServer())
      .get(`/courses/${courseId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(404);
  });
});
