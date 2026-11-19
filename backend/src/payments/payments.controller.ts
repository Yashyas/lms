import { Controller, Get, Post, Body, Param, Req, type RawBodyRequest, BadRequestException, Headers } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { ConfigService } from '@nestjs/config';
import { AllowAnonymous, Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { VerifySessionDto } from './dto/verify-session.dto.js';
import Stripe from 'stripe';
import type { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly config: ConfigService,
  ) { }

  /**
 * 1. Create a checkout session (Authenticated Student)
 */
  @Post('checkout/:courseId')
  createCheckout(@Param("courseId") courseId: string, @Session() session: UserSession) {
    return this.paymentsService.createCheckoutSession(courseId, session.user);
  }

  /**
   * 2. Verify session on client redirect (Immediate UI feedback)
   */
  @Post('verify-session')
  verifySession(@Body() dto: VerifySessionDto, @Session() session: UserSession) {
    return this.paymentsService.verifySession(dto.sessionId, session.user);
  }

  /**
 * 3. Get student payment receipts history
 */
  @Get('my-history')
  getMyPayments(@Session() session: UserSession) {
    return this.paymentsService.getMyPayments(session.user);
  }

  /**
 * 4. Get course payments (Instructor or Admin)
 */
  @Get('course/:courseId')
  getCoursePayments(@Param('courseId') courseId: string, @Session() session: UserSession,) {
    return this.paymentsService.getCoursePayments(courseId, session.user);
  }

  /**
   * 5. Active Refund (Admin Only)
   */
  @Roles(['admin'])
  @Post('refund/:paymentId')
  refundPayment(
    @Param('paymentId') paymentId: string,
    @Session() session: UserSession,
  ) {
    return this.paymentsService.refundPayment(paymentId, session.user);
  }

  /**
   * 6. Stripe Webhook Listener (Authoritative background sync)
   */
  @Post('webhook')
  @AllowAnonymous()
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header')
    }

    if (!req.rawBody) {
      throw new BadRequestException('Raw body not available. Ensure rawBody: true in main.ts')
    }

    const secret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET')
    const event = this.paymentsService.constructWebhookEvent(req.rawBody, signature, secret)

    switch (event.type) {
      case 'checkout.session.completed':
        await this.paymentsService.fulfillOrder(event.data.object as Stripe.Checkout.Session)
        break

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session
        await this.paymentsService.markpaymentFailed(session.id, 'Checkout session expired')
        break
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent
        const errorMsg = intent.last_payment_error?.message || 'Payment intent failed'
        await this.paymentsService.markpaymentFailed(intent.id, errorMsg)
        break
      }

      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session
        await this.paymentsService.markpaymentFailed(session.id, 'Async payment failed')
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id
        if (paymentIntentId) {
          await this.paymentsService.revokeEnrollment(paymentIntentId)
        }
        break
      }
    }
    return { received: true }
  }
}
