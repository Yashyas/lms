import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { AuthUser, DbPoolService } from '../db-pool/db-pool.service.js';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@lms/db';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: DbPoolService,
    private readonly config: ConfigService,
  ) {
    const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2026-10-28.endive',
    });
  }

  async createCheckoutSession(courseId: string, user: AuthUser) {
    const course = await this.db.client.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        slug: true,
        price: true,
        published: true,
        thumbnail: true,
        instructorId: true,
      },
    });

    if (!course) {
      throw new NotFoundException(`Course with id ${courseId} not found`);
    }

    if (!course.published) {
      throw new BadRequestException('Cannot purchase an unpublished course')
    }

    if (course.instructorId === user.id) {
      throw new BadRequestException('Cannot purchase your own course')
    }

    if (course.price <= 0) {
      throw new BadRequestException('Cannot purchase a free course')
    }

    // check if already enrolled 
    const existingEnrollment = await this.db.forUser(user).enrollment.findUnique({
      where: {
        // composite index 
        userId_courseId: { userId: user.id, courseId: course.id }
      },
    })

    if (existingEnrollment) {
      throw new ConflictException('You are already enrolled in this course')
    }

    // create pending payment in db 
    const payment = await this.db.payment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        userEmail: user.email,
        courseTitle: course.title,
        price: course.price,
        currency: 'usd',
        status: PaymentStatus.PENDING,
        provider: 'stripe',
      },
    })

    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');

    // stripe checkout session 
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      customer_creation: 'always',
      client_reference_id: payment.id,
      payment_intent_data: {
        metadata: {
          paymentId: payment.id,
          courseId: course.id,
          userId: user.id,
        },
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: course.title,
              images: course.thumbnail && course.thumbnail.startsWith('http') ? [course.thumbnail] : [],
            },
            unit_amount: course.price,
          },
          quantity: 1,
        },
      ],
      metadata: {
        paymentId: payment.id,
        courseId: course.id,
        userId: user.id,
      },
      success_url: `${frontendUrl}/payment-success?sessionId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/courses/${course.slug}?canceled=true`,
    })

    // save stripe session into db
    await this.db.client.payment.update({
      where: { id: payment.id },
      data: {
        stripeSessionId: session.id,
      },
    })

    return { url: session.url, sessionId: session.id, }
  }

  // idempotent order payment complete 
  async fulfillOrder(session: Stripe.Checkout.Session) {
    const paymentId = session.metadata?.paymentId
    const courseId = session.metadata?.courseId
    const userId = session.metadata?.userId

    if (session.payment_status !== 'paid') {
      this.logger.warn(`Session ${session.id} payment_status is '${session.payment_status}', not 'paid'. Holding enrollment.`);
      return;
    }

    if (!paymentId || !courseId || !userId) {
      this.logger.warn(`Missing metadata in checkout session: ${session.id}`);
      return;
    }

    // transaction to ensure atomicity  
    return await this.db.client.$transaction(async (tx) => {
      // fetch payment record 
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
      })

      if (!payment) {
        throw new NotFoundException(`Payment not found for id: ${paymentId}`)
      }

      if (payment.status === PaymentStatus.COMPLETED) {
        this.logger.log(`Payment ${paymentId} already completed, skipping`)
        return payment
      }

      if (payment.status === PaymentStatus.REFUNDED) {
        this.logger.warn(`Payment ${paymentId} has already been refunded. Refusing fulfillment.`)
        return payment
      }

      // check if the cost of course is same as the payment amout before moving to enrollment
      if (session.amount_total === null || session.amount_total === undefined) {
        this.logger.error(`Session ${session.id} is missing amount_total from Stripe`)
        throw new BadRequestException('Invalid Stripe session: missing amount_total')
      }
      if (session.amount_total !== payment.price) {
        this.logger.error(`Payment amount ${session.amount_total} does not match the course price ${payment.price}`)
        throw new BadRequestException('Payment amount does not match the course price')
      }
      if (session.currency && session.currency.toLowerCase() !== payment.currency.toLowerCase()) {
        this.logger.error(`Currency mismatch: expected ${payment.currency}, received ${session.currency}`)
        throw new BadRequestException('Payment currency mismatch detected')
      }
      // create/finds enrollment 
      const enrollment = await tx.enrollment.upsert({
        where: {
          userId_courseId: { userId, courseId },
        },
        create: {
          userId,
          courseId,
        },
        update: {},
      })

      const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

      // mark payment complete 
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.COMPLETED,
          enrollmentId: enrollment.id,
          stripePaymentIntentId: paymentIntentId,
          provider: "stripe",
        }
      })

      this.logger.log(`Payment ${paymentId} fulfilled successfully for user ${userId}`)
      return updatedPayment
    })

  }


  // instant client side redirect from payment 
  async verifySession(sessionId: string, user: AuthUser) {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId)

    if (!session || session.payment_status !== 'paid') {
      throw new BadRequestException('Payment has not been completed')
    }

    if (session.metadata?.userId !== user.id) {
      throw new BadRequestException('Session does not belong to the authenticated user')
    }

    // call fulfillOrder 
    const payment = await this.fulfillOrder(session)

    const course = await this.db.client.course.findUnique({
      where: { id: session.metadata?.courseId },
      select: {
        slug: true,
        title: true,
      }
    })

    return {
      success: true,
      courseSlug: course?.slug,
      courseTitle: course?.title,
      payment,
    }
  }

  // revocation triggered by refund  
  async revokeEnrollment(paymentIntentId: string) {
    if (!paymentIntentId) return

    const payment = await this.db.client.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    })

    if (!payment) {
      this.logger.warn(`No payment found for refunded intent: ${paymentIntentId}`)
      return
    }

    // exit if already refunded 
    if (payment.status === PaymentStatus.REFUNDED && !payment.enrollmentId) {
      return payment
    }

    return await this.db.client.$transaction(async (tx) => {

      // delete enrollment if still enrolled 
      if (payment.enrollmentId) {
        await tx.enrollment.deleteMany({
          where: { id: payment.enrollmentId }
        })
      }
      // fallback to userId and courseId if enrollmentId is not present 
      else if (payment.userId && payment.courseId) {
        await tx.enrollment.deleteMany({
          where: {
            userId: payment.userId,
            courseId: payment.courseId,
          }
        })
      }

      // mark payment refund
      return await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.REFUNDED,
          enrollmentId: null,
        }
      })
    })

  }

  // called by admin only for refund action
  async refundPayment(paymentId: string, user: AuthUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only administrators can issue refunds')
    }

    const payment = await this.db.client.payment.findUnique({
      where: { id: paymentId },
    })

    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`)
    }

    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Only completed payments can be refunded')
    }

    if (!payment.stripePaymentIntentId) {
      throw new BadRequestException('Missing stripe payment intent id, cannot refund this payment')
    }

    // refund the payment
    const refund = await this.stripe.refunds.create({
      payment_intent: payment.stripePaymentIntentId,
    })

    // revoke enrollment 
    await this.revokeEnrollment(payment.stripePaymentIntentId)

    return {
      success: true,
      refundId: refund.id,
      status: refund.status,
    }
  }

  // get payments for studets 
  async getMyPayments(user: AuthUser) {
    return await this.db.forUser(user).payment.findMany({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            thumbnail: true,

          }
        }
      }
    })
  }

  async getCoursePayments(courseId: string, user: AuthUser) {
    const course = await this.db.forUser(user).course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        instructorId: true,
      }
    })

    if (!course) {
      throw new NotFoundException(`Course not found`)
    }

    if (course.instructorId !== user.id && user.role !== 'admin') {
      throw new ForbiddenException(`You are not authorized to view payments for this course`)
    }

    return await this.db.forUser(user).payment.findMany({
      where: { courseId: courseId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async markpaymentFailed(sessionOrPaymentIntentId: string, reason?: string) {
    if (!sessionOrPaymentIntentId) {
      throw new BadRequestException('Session or payment intent id is required')
    }
    // find payment by either stripeSessionId or stripepaymentIntentId 
    const payment = await this.db.client.payment.findFirst({
      where: {
        OR: [
          { stripeSessionId: sessionOrPaymentIntentId },
          { stripePaymentIntentId: sessionOrPaymentIntentId },
        ],
      },
    })

    if (!payment) {
      this.logger.warn(`No payment record found to mark as failed for ID: ${sessionOrPaymentIntentId}`)
      return
    }

    if (payment.status === PaymentStatus.COMPLETED || payment.status === PaymentStatus.REFUNDED) {
      return payment
    }

    const updatedPayment = await this.db.client.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
      },
    })

    this.logger.log(`Payment ${payment.id} marked as failed. Reason:${reason || "Payment failed or session expired"}`)
    return updatedPayment
  }

  // Webhook event construction 
  constructWebhookEvent(rawBody: Buffer, signature: string, secret: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, secret) as Stripe.Event
    } catch (err: any) {
      this.logger.error(`Webhook validation failed: ${err.message} `)
      throw new BadRequestException(`Webhook validation failed: ${err.message}`)
    }
  }




}
