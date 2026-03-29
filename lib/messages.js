// All WhatsApp message payload builders
// This is the ONLY file with user-facing strings.
// Edit copy here — no hardcoded strings elsewhere.

const { truncateForList } = require('./menu');

const PHONE_NUMBER_ID = () => process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN = () => process.env.WHATSAPP_TOKEN;

// ─── WhatsApp API sender ─────────────────────────────────────────

async function sendMessage(to, payload) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID()}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to,
    ...payload,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[WA] Send failed (${res.status}):`, errBody);
    }
  } catch (err) {
    console.error('[WA] Send error:', err.message);
  }
}

// ─── Text message ────────────────────────────────────────────────

function textPayload(body) {
  return { type: 'text', text: { preview_url: false, body } };
}

// ─── Reply buttons (max 3) ───────────────────────────────────────

function buttonPayload(bodyText, buttons) {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: truncateForList(btn.title),
          },
        })),
      },
    },
  };
}

// ─── Interactive list ────────────────────────────────────────────

function listPayload(bodyText, buttonLabel, sections) {
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: truncateForList(buttonLabel),
        sections: sections.map((sec) => ({
          title: sec.title ? truncateForList(sec.title) : undefined,
          rows: sec.rows.map((row) => ({
            id: row.id,
            title: truncateForList(row.title),
            description: row.description || undefined,
          })),
        })),
      },
    },
  };
}

// ─── Message 1: Welcome ──────────────────────────────────────────

function welcomeMessage(surgeModeOn) {
  let body = `🌙 *Din Raat Bites*\nManipal/Udupi's 24/7 Halal cloud kitchen.\n\nMidnight craving? Morning grub? Lunch punch?\nWe've got you covered 👇`;

  if (surgeModeOn) {
    body += `\n\n⚠️ _High order volume right now. Deliveries may take 45–60 mins._`;
  }

  return buttonPayload(body, [{ id: 'browse_menu', title: 'Browse Menu 🍽️' }]);
}

function returningCustomerGreeting(surgeModeOn) {
  let body = `Welcome back! 👋 What are you ordering tonight?`;

  if (surgeModeOn) {
    body += `\n\n⚠️ _High order volume right now. Deliveries may take 45–60 mins._`;
  }

  return body; // This is used as text preceding the category list
}

function kitchenClosedMessage() {
  return textPayload(
    `😴 We're taking a short break right now.\nWe'll be back very soon — message us again in a bit!\nDin Raat Bites 🌙`
  );
}

function surgeWarning() {
  return `⚠️ _High order volume right now. Deliveries may take 45–60 mins._`;
}

// ─── Message 2: Category picker ──────────────────────────────────

function categoryListPayload(categories, bodyText) {
  const defaultBody = bodyText || `What are you craving? Pick a category 👇`;

  return listPayload(defaultBody, 'See categories', [
    {
      title: 'What are you feeling?',
      rows: categories.map((cat) => ({
        id: `cat_${cat.id}`,
        title: cat.display,
      })),
    },
  ]);
}

// ─── Message 3: Item picker ──────────────────────────────────────

function itemListPayload(categoryName, items, sections) {
  const body = `*${categoryName}*\nPick an item to add to your order 👇`;

  if (sections) {
    // Pre-built sections (for categories with sub-types)
    return listPayload(body, 'See items', sections);
  }

  return listPayload(body, 'See items', [
    {
      title: categoryName,
      rows: items.map((item) => ({
        id: `item_${item.item_id}`,
        title: item.list_display || item.item_name,
        description: `₹${item.price}`,
      })),
    },
  ]);
}

// ─── Sub-category list (Burgers, Chinese) ────────────────────────

function subCategoryListPayload(parentName, subcategories) {
  const body = `*${parentName}*\nPick a type 👇`;

  return listPayload(body, 'See types', [
    {
      title: parentName,
      rows: subcategories.map((sub) => ({
        id: `cat_${sub.id}`,
        title: sub.display,
      })),
    },
  ]);
}

// ─── Variant prompt ──────────────────────────────────────────────

function variantPromptPayload(itemName, variants) {
  const body = `*${itemName}* — choose your style:`;

  if (variants.length <= 3) {
    // Use reply buttons
    return buttonPayload(
      body,
      variants.map((v) => ({
        id: `var_${v.variant}`,
        title: `${v.variant} ₹${v.price}`,
      }))
    );
  }

  // Use list for more than 3 variants
  return listPayload(body, 'Choose variant', [
    {
      title: 'Options',
      rows: variants.map((v) => ({
        id: `var_${v.variant}`,
        title: `${v.variant}`,
        description: `₹${v.price}`,
      })),
    },
  ]);
}

// ─── Seasoning prompt (Fried Chicken) ────────────────────────────

function seasoningPromptPayload(itemName) {
  return buttonPayload(`✅ *${itemName}* — want seasoning?`, [
    { id: 'season_periperi', title: 'Periperi' },
    { id: 'season_lemonchilli', title: 'Lemon Chilli' },
    { id: 'season_none', title: 'No thanks' },
  ]);
}

// ─── Message 4: Item added ───────────────────────────────────────

function itemAddedMessage(itemName, price, cartTotal) {
  const body = `✅ *${itemName}* added — ₹${price}\nCart total: ₹${cartTotal}`;

  return buttonPayload(body, [
    { id: 'add_more', title: '➕ Add more' },
    { id: 'checkout', title: '🛒 Checkout' },
  ]);
}

// ─── Message 5: Cart summary + forgot nudge ─────────────────────

function cartSummaryMessage(cartItems, total, missingCategories, forgotNudgeSent) {
  let body = `🛒 *Your order:*\n\n`;

  for (const item of cartItems) {
    body += `${item.displayName || item.name} × ${item.qty}     ₹${item.price * item.qty}\n`;
  }

  body += `──────────────────\n*Total: ₹${total}*`;

  if (!forgotNudgeSent) {
    if (missingCategories && missingCategories.length >= 3) {
      body += `\n\n💡 _Anything you missed?_\n${missingCategories.join(', ')}`;
    } else {
      body += `\n\n💡 _Want to add a drink or an extra side?_\n🍿 Popcorn  🌯 Wraps  🍟 Extra Fries`;
    }
  }

  return buttonPayload(body, [
    { id: 'add_more', title: '➕ Add something' },
    { id: 'confirm_order', title: '✅ Confirm order' },
  ]);
}

// ─── Message 6: Delivery zone picker ─────────────────────────────

function locationZoneListPayload(zones) {
  const body = `📍 Where should we deliver?`;

  return listPayload(body, 'Pick your area', [
    {
      title: 'Where should we deliver?',
      rows: zones.map((zone, i) => ({
        id: `zone_${i}`,
        title: zone === 'Other' ? 'Other (type address)' : zone,
      })),
    },
  ]);
}

// ─── Message 7: Room / address request ───────────────────────────

function roomRequestMessage(zone) {
  if (zone === 'Other' || zone === 'Other (type your address)' || zone === 'Other (type address)') {
    return textPayload(
      `📍 No problem!\n\nType your full delivery address:\n_e.g. 14 KMC Road, near SBI ATM, Manipal_`
    );
  }

  return textPayload(
    `📍 *${zone}* got it!\n\nDrop your room number or building name:\n_e.g. Block B Room 204, Acharya Hostel Room 12_`
  );
}

// ─── Message 8: Order summary + payment link ─────────────────────

function orderSummaryWithPaymentMessage(cart, total, zone, room, orderId, paymentLink) {
  let body = `🧾 *Almost there!*\n\n`;

  for (const item of cart) {
    body += `${item.displayName || item.name} × ${item.qty}     ₹${item.price * item.qty}\n`;
  }

  body += `──────────────────\n*Total: ₹${total}*\n\n`;
  body += `📍 ${zone}, ${room}\n`;
  body += `🔖 Order ID: ${orderId}\n\n`;

  if (paymentLink && !paymentLink.includes('dinraat-demo')) {
    body += `Pay to confirm your order 👇\n💳 *Pay ₹${total} securely*\n${paymentLink}\n\n`;
    body += `_Your order is placed once payment is complete._`;
  } else {
    // Cash fallback when Razorpay is not configured
    body += `Reply *CONFIRM* to place your order (cash on delivery) 💵`;
  }

  return textPayload(body);
}

// ─── Message 9: Order confirmed ──────────────────────────────────

function orderConfirmedMessage(deliveryTime) {
  return textPayload(
    `🎉 *Payment received! You're all set.*\n\nYour order is being prepared right now.\nEstimated delivery: *${deliveryTime}* 🛵\n\nThank you for ordering from Din Raat Bites! 🌙`
  );
}

// ─── Owner alerts ────────────────────────────────────────────────

function ownerPendingAlertMessage(orderId, phone, cart, total, zone, room) {
  const last4 = phone.slice(-4);
  const items = cart.map((i) => `${i.displayName || i.name} ×${i.qty}`).join(', ');

  return textPayload(
    `🔔 *New Order — Awaiting Payment*\nOrder ID: ${orderId}\nPhone: ${last4}XXXX\nItems: ${items}\nTotal: ₹${total}\nLocation: ${zone}, ${room}`
  );
}

function ownerConfirmedAlertMessage(orderId, phone, cart, total, zone, room) {
  const last4 = phone.slice(-4);
  const items = cart.map((i) => `${i.displayName || i.name} ×${i.qty}`).join(', ');

  return textPayload(
    `✅ *Payment Confirmed — Start Cooking!*\nOrder ID: ${orderId}\nItems: ${items}\nTotal: ₹${total}\nLocation: ${zone}, ${room}\nCustomer: ${last4}XXXX`
  );
}

// ─── Error / utilities ───────────────────────────────────────────

function errorFallbackMessage() {
  return textPayload(
    `Oops, something went wrong on our end! 😅\nPlease try again in a moment. If the issue persists, call us at 8105967010.\nDin Raat Bites 🌙`
  );
}

function tapPromptMessage() {
  return textPayload(`Just tap one of the options above 👆`);
}

function resetMessage() {
  return textPayload(`No worries! Come back anytime 🌙 Din Raat Bites`);
}

function emptyCartMessage() {
  return buttonPayload(`Your cart is empty! Browse the menu first 👇`, [
    { id: 'browse_menu', title: 'Browse Menu 🍽️' },
  ]);
}

function showCartMessage(cartItems, total) {
  let body = `🛒 *Your current cart:*\n\n`;
  for (const item of cartItems) {
    body += `${item.displayName || item.name} × ${item.qty}     ₹${item.price * item.qty}\n`;
  }
  body += `──────────────────\n*Total: ₹${total}*`;

  return buttonPayload(body, [
    { id: 'add_more', title: '➕ Add more' },
    { id: 'checkout', title: '🛒 Checkout' },
  ]);
}

function cashConfirmMessage(deliveryTime) {
  return textPayload(
    `🎉 *Order confirmed! Cash on delivery.*\n\nYour order is being prepared right now.\nEstimated delivery: *${deliveryTime}* 🛵\n\nKeep the exact change ready if you can!\nThank you for ordering from Din Raat Bites! 🌙`
  );
}

module.exports = {
  sendMessage,
  welcomeMessage,
  returningCustomerGreeting,
  kitchenClosedMessage,
  surgeWarning,
  categoryListPayload,
  itemListPayload,
  subCategoryListPayload,
  variantPromptPayload,
  seasoningPromptPayload,
  itemAddedMessage,
  cartSummaryMessage,
  locationZoneListPayload,
  roomRequestMessage,
  orderSummaryWithPaymentMessage,
  orderConfirmedMessage,
  ownerPendingAlertMessage,
  ownerConfirmedAlertMessage,
  errorFallbackMessage,
  tapPromptMessage,
  resetMessage,
  emptyCartMessage,
  showCartMessage,
  cashConfirmMessage,
};
