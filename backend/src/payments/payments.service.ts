import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
      apiVersion: '2026-10-28.endive' as any,
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

    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL', 'http://localhost:3001');

    // stripe checkout session 
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      customer_creation: 'always',
      client_reference_id: payment.id,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: course.title,
              images: course.thumbnail ? [course.thumbnail] : [],
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
      success_url: `${frontendUrl}/payment-success?paymentId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/payment-cancel`,
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


  fulfillOrder() {
    return `This action returns all payments`;
  }

  verifySession() {
    return `This action returns a #${id} payment`;
  }

  revokeEnrollment(id: number) {
    return `This action updates a #${id} payment`;
  }

  getMyPayments() {
    return `This action removes a #${id} payment`;
  }

  getCoursePayments() {
    return `This action removes a #${id} payment`;
  }
}
