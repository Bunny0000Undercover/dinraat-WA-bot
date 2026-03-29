// Vercel serverless function — WhatsApp + Razorpay webhook handler

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { handleMessage, handlePaymentConfirmed } = require('../lib/flow');
const { verifyWebhookSignature } = require('../lib/razorpay');

module.exports = async function handler(req, res) {
  const method = req.method;
  const source = req.query?.source;

  // ─── GET: Meta verification handshake ─────────────────────────
  if (method === 'GET') {
    // Testing endpoint (dev only)
    if (req.query?.order_id && process.env.NODE_ENV !== 'production') {
      try {
        await handlePaymentConfirmed(req.query.order_id);
        return res.status(200).send(`Test confirm triggered for ${req.query.order_id}`);
      } catch (err) {
        console.error('[TEST] Confirm error:', err);
        return res.status(500).send('Error: ' + err.message);
      }
    }

    // Meta webhook verification
    const mode = req.query?.['hub.mode'];
    const token = req.query?.['hub.verify_token'];
    const challenge = req.query?.['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      console.log('[WEBHOOK] Verification successful');
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  }

  // ─── POST: Incoming messages or Razorpay webhook ──────────────
  if (method === 'POST') {
    // Razorpay payment webhook
    if (source === 'razorpay') {
      return await handleRazorpayWebhook(req, res);
    }

    // WhatsApp message webhook
    return await handleWhatsAppWebhook(req, res);
  }

  return res.status(405).send('Method Not Allowed');
};

// ─── WhatsApp webhook handler ───────────────────────────────────

async function handleWhatsAppWebhook(req, res) {
  // Always respond 200 immediately — Meta requires acknowledgement within 1 second
  res.status(200).send('OK');

  try {
    const body = req.body;

    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      // Status update or non-message webhook — ignore
      return;
    }

    const value = body.entry[0].changes[0].value;
    const message = value.messages[0];
    const phone = message.from;

    let messageType = message.type;
    let messageContent = {};

    switch (messageType) {
      case 'text':
        messageContent = { body: message.text?.body || '' };
        break;

      case 'interactive':
        messageType = 'interactive';
        if (message.interactive?.type === 'list_reply') {
          messageContent = {
            type: 'list_reply',
            list_reply: {
              id: message.interactive.list_reply.id,
              title: message.interactive.list_reply.title,
            },
          };
        } else if (message.interactive?.type === 'button_reply') {
          messageContent = {
            type: 'button_reply',
            button_reply: {
              id: message.interactive.button_reply.id,
              title: message.interactive.button_reply.title,
            },
          };
        } else {
          console.log(`[WEBHOOK] Unknown interactive type: ${message.interactive?.type}`);
          return;
        }
        break;

      default:
        console.log(`[WEBHOOK] Ignoring message type: ${messageType}`);
        return;
    }

    // Process through state machine
    await handleMessage(phone, messageType, messageContent);
  } catch (err) {
    console.error('[WEBHOOK] Processing error:', err);
  }
}

// ─── Razorpay webhook handler ───────────────────────────────────

async function handleRazorpayWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body;

    // Verify signature if Razorpay is configured
    if (process.env.RAZORPAY_KEY_SECRET) {
      if (!verifyWebhookSignature(body, signature)) {
        console.error('[RAZORPAY] Invalid webhook signature');
        return res.status(400).send('Invalid signature');
      }
    }

    const event = body?.event;

    if (event === 'payment.captured' || event === 'payment_link.paid') {
      const orderId =
        body?.payload?.payment?.entity?.description ||
        body?.payload?.payment_link?.entity?.description ||
        null;

      if (orderId) {
        console.log(`[RAZORPAY] Payment captured for order: ${orderId}`);
        await handlePaymentConfirmed(orderId);
      } else {
        console.warn('[RAZORPAY] Payment captured but no order ID found in description');
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[RAZORPAY] Webhook error:', err);
    return res.status(500).send('Error');
  }
}
