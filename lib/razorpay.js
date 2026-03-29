// Razorpay Payment Link generator
// Status: STUB — returns placeholder until keys are configured
// To activate: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel env vars,
// then uncomment the live block below.

async function createPaymentLink(orderId, amountRupees, customerPhone) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.log(`[Razorpay stub] Order ${orderId} | Amount ₹${amountRupees} | Phone ${maskPhone(customerPhone)}`);
    return `https://rzp.io/l/dinraat-demo`;
  }

  // ──────────────────────────────────────────────
  // Activate by uncommenting below when keys are ready:
  // ──────────────────────────────────────────────
  //
  // const Razorpay = require('razorpay');
  // const rzp = new Razorpay({
  //   key_id: process.env.RAZORPAY_KEY_ID,
  //   key_secret: process.env.RAZORPAY_KEY_SECRET,
  // });
  // const link = await rzp.paymentLink.create({
  //   amount: amountRupees * 100, // Razorpay expects paise
  //   currency: 'INR',
  //   description: orderId,
  //   customer: { contact: `+${customerPhone}` },
  //   notify: { whatsapp: false }, // We handle WhatsApp ourselves
  //   callback_url: `${process.env.VERCEL_URL}/webhook?source=razorpay`,
  //   callback_method: 'get',
  //   expire_by: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min expiry
  // });
  // return link.short_url;
}

function verifyWebhookSignature(body, signature) {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;

  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');

  return expectedSignature === signature;
}

function maskPhone(phone) {
  if (!phone || phone.length < 4) return 'XXXX';
  return phone.slice(-4) + 'XXXX';
}

module.exports = { createPaymentLink, verifyWebhookSignature };
