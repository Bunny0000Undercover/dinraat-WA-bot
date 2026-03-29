// Core conversation state machine
// Handles all WhatsApp message processing and state transitions

const { getState, setState, clearState, maskPhone } = require('./state');
const menu = require('./menu');
const msg = require('./messages');
const sheets = require('./sheets');
const { createPaymentLink } = require('./razorpay');

// ─── Rate Limiting ───────────────────────────────────────────────

function shouldRateLimit(state) {
  const now = Date.now();
  const timeSinceLast = now - (state.lastMessageTime || 0);

  if (timeSinceLast < 1000 && state.messageCount > 5) {
    return true; // Silently ignore
  }

  return false;
}

function updateRateLimit(state) {
  const now = Date.now();
  const timeSinceLast = now - (state.lastMessageTime || 0);

  if (timeSinceLast > 60000) {
    state.messageCount = 1;
  } else {
    state.messageCount = (state.messageCount || 0) + 1;
  }
  state.lastMessageTime = now;
}

// ─── Generate order ID ──────────────────────────────────────────

function generateOrderId() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `DRB-${mm}${dd}-${rand}`;
}

// ─── Cart helpers ────────────────────────────────────────────────

function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function addToCart(cart, item) {
  const existing = cart.find(
    (c) => c.name === item.name && c.variant === item.variant
  );
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  return cart;
}

// ─── Keyword detection (reset triggers) ─────────────────────────

const RESET_KEYWORDS = ['menu', 'start', 'hi', 'hello', 'hey', 'hola'];
const CANCEL_KEYWORDS = ['cancel', 'stop'];
const CART_KEYWORDS = ['cart', 'my order'];

function isResetKeyword(text) {
  return RESET_KEYWORDS.includes(text.toLowerCase().trim());
}

function isCancelKeyword(text) {
  return CANCEL_KEYWORDS.includes(text.toLowerCase().trim());
}

function isCartKeyword(text) {
  return CART_KEYWORDS.includes(text.toLowerCase().trim());
}

// ─── Main flow handler ──────────────────────────────────────────

async function handleMessage(phone, messageType, messageContent) {
  const logPhone = maskPhone(phone);

  try {
    let state = await getState(phone);

    // Rate limiting check
    if (shouldRateLimit(state)) {
      console.log(`[RATE] ${logPhone} — rate limited, ignoring`);
      return;
    }
    updateRateLimit(state);

    // Extract text content for keyword checking
    let textBody = '';
    let interactiveId = '';
    let interactiveTitle = '';

    if (messageType === 'text') {
      textBody = messageContent.body || '';
    } else if (messageType === 'interactive') {
      if (messageContent.type === 'list_reply') {
        interactiveId = messageContent.list_reply.id;
        interactiveTitle = messageContent.list_reply.title;
      } else if (messageContent.type === 'button_reply') {
        interactiveId = messageContent.button_reply.id;
        interactiveTitle = messageContent.button_reply.title;
      }
    } else {
      // Unsupported message type — ignore
      console.log(`[FLOW] ${logPhone} — unsupported message type: ${messageType}`);
      return;
    }

    // ─── Global keyword handlers ────────────────────────────────

    if (textBody && isResetKeyword(textBody)) {
      console.log(`[STATE] ${logPhone} → IDLE (reset keyword: ${textBody})`);
      state = { ...state, state: 'IDLE', cart: [], currentCategory: null, currentItem: null, deliveryZone: null, roomDetail: null, forgotNudgeSent: false, orderId: null };
      await setState(phone, state);
      // Fall through to IDLE handler
    }

    if (textBody && isCancelKeyword(textBody)) {
      console.log(`[STATE] ${logPhone} → IDLE (cancelled)`);
      await clearState(phone);
      await msg.sendMessage(phone, msg.resetMessage());
      return;
    }

    if (textBody && isCartKeyword(textBody) && state.state !== 'IDLE') {
      if (state.cart.length === 0) {
        await msg.sendMessage(phone, msg.emptyCartMessage());
      } else {
        await msg.sendMessage(phone, msg.showCartMessage(state.cart, cartTotal(state.cart)));
      }
      return;
    }

    // ─── CONFIRM keyword for cash-on-delivery ───────────────────
    if (textBody && textBody.toUpperCase().trim() === 'CONFIRM' && state.state === 'AWAITING_PAYMENT') {
      return await handleCashConfirm(phone, state);
    }

    // ─── State machine ─────────────────────────────────────────

    switch (state.state) {
      case 'IDLE':
        return await handleIdle(phone, state);

      case 'BROWSING_CATEGORIES':
        return await handleBrowsingCategories(phone, state, messageType, textBody, interactiveId);

      case 'BROWSING_ITEMS':
        return await handleBrowsingItems(phone, state, messageType, textBody, interactiveId, interactiveTitle);

      case 'AWAITING_VARIANT':
        return await handleAwaitingVariant(phone, state, messageType, textBody, interactiveId, interactiveTitle);

      case 'AWAITING_SEASONING':
        return await handleAwaitingSeasoning(phone, state, messageType, textBody, interactiveId);

      case 'ITEM_ADDED':
        return await handleItemAdded(phone, state, messageType, textBody, interactiveId);

      case 'CHECKOUT':
        return await handleCheckout(phone, state, messageType, textBody, interactiveId);

      case 'AWAITING_LOCATION_ZONE':
        return await handleAwaitingLocationZone(phone, state, messageType, textBody, interactiveId, interactiveTitle);

      case 'AWAITING_ROOM':
        return await handleAwaitingRoom(phone, state, messageType, textBody);

      case 'AWAITING_PAYMENT':
        // Waiting for Razorpay webhook — remind customer
        await msg.sendMessage(phone, {
          type: 'text',
          text: { preview_url: false, body: `⏳ We're waiting for your payment to come through.\nIf you haven't paid yet, use the link above 👆\n\nHaving trouble? Call us at 8105967010.` },
        });
        return;

      default:
        console.error(`[FLOW] ${logPhone} — unknown state: ${state.state}`);
        state.state = 'IDLE';
        await setState(phone, state);
        return await handleIdle(phone, state);
    }
  } catch (err) {
    console.error(`[FLOW] Error for ${maskPhone(phone)}:`, err);
    await msg.sendMessage(phone, msg.errorFallbackMessage());
  }
}

// ─── State handlers ─────────────────────────────────────────────

async function handleIdle(phone, state) {
  const logPhone = maskPhone(phone);

  // Kitchen closed check
  const kitchenOpen = await menu.isKitchenOpen();
  if (!kitchenOpen) {
    console.log(`[STATE] ${logPhone} → IDLE (kitchen closed)`);
    await msg.sendMessage(phone, msg.kitchenClosedMessage());
    state.state = 'IDLE';
    await setState(phone, state);
    return;
  }

  const surgeOn = await menu.getSurgeMode();

  // Returning customer fast-track
  if (state.isReturningCustomer) {
    console.log(`[STATE] ${logPhone} → BROWSING_CATEGORIES (returning customer)`);
    const categories = await menu.getAllCategories();
    const greeting = msg.returningCustomerGreeting(surgeOn);
    const catPayload = msg.categoryListPayload(categories, greeting);
    await msg.sendMessage(phone, catPayload);
    state.state = 'BROWSING_CATEGORIES';
    await setState(phone, state);
    return;
  }

  // Normal welcome
  console.log(`[STATE] ${logPhone} → BROWSING_CATEGORIES (new welcome)`);
  await msg.sendMessage(phone, msg.welcomeMessage(surgeOn));
  state.state = 'BROWSING_CATEGORIES';
  await setState(phone, state);
}

async function handleBrowsingCategories(phone, state, messageType, textBody, interactiveId) {
  const logPhone = maskPhone(phone);

  // Handle "Browse Menu" button tap
  if (interactiveId === 'browse_menu') {
    const categories = await menu.getAllCategories();
    const surgeOn = await menu.getSurgeMode();

    // Check if returning customer but tapped browse menu anyway
    const bodyText = state.isReturningCustomer
      ? msg.returningCustomerGreeting(surgeOn)
      : undefined;

    await msg.sendMessage(phone, msg.categoryListPayload(categories, bodyText));
    return;
  }

  // Handle category selection from list
  if (interactiveId && interactiveId.startsWith('cat_')) {
    const categoryId = interactiveId.replace('cat_', '');
    return await showCategoryItems(phone, state, categoryId);
  }

  // Free text when expecting a tap
  if (textBody) {
    await msg.sendMessage(phone, msg.tapPromptMessage());
    return;
  }
}

async function showCategoryItems(phone, state, categoryId) {
  const logPhone = maskPhone(phone);

  // Check for sub-categories (Burgers, Chinese)
  if (categoryId === 'burgers') {
    const subcats = menu.getBurgerSubcategories();
    await msg.sendMessage(phone, msg.subCategoryListPayload('🍔 Burgers', subcats));
    // Stay in BROWSING_CATEGORIES to handle sub-category selection
    state.currentCategory = 'burgers';
    await setState(phone, state);
    return;
  }

  if (categoryId === 'chinese') {
    const subcats = menu.getChineseSubcategories();
    await msg.sendMessage(phone, msg.subCategoryListPayload('🥢 Chinese', subcats));
    state.currentCategory = 'chinese';
    await setState(phone, state);
    return;
  }

  // Regular category — fetch items
  const items = await menu.getMenuByCategory(categoryId);
  const categoryName = menu.getCategoryDisplay(categoryId);

  if (items.length === 0) {
    await msg.sendMessage(phone, {
      type: 'text',
      text: { preview_url: false, body: `😕 No items available in this category right now. Try another one!` },
    });
    return;
  }

  // Group items by variant — deduplicate (show unique item_ids)
  const uniqueItems = [];
  const seenIds = new Set();
  for (const item of items) {
    if (!seenIds.has(item.item_id)) {
      seenIds.add(item.item_id);
      // For items with variants, show the lowest price
      const allVariants = items.filter((i) => i.item_id === item.item_id);
      const minPrice = Math.min(...allVariants.map((v) => v.price));
      uniqueItems.push({
        ...item,
        price: minPrice,
        hasVariants: allVariants.length > 1 || allVariants.some((v) => v.variant),
      });
    }
  }

  const priceLabel = (item) =>
    item.hasVariants ? `from ₹${item.price}` : `₹${item.price}`;

  const payload = msg.itemListPayload(categoryName, null, [
    {
      title: categoryName,
      rows: uniqueItems.map((item) => ({
        id: `item_${item.item_id}`,
        title: item.list_display || item.item_name,
        description: priceLabel(item),
      })),
    },
  ]);

  console.log(`[STATE] ${logPhone} → BROWSING_ITEMS (${categoryId})`);
  state.state = 'BROWSING_ITEMS';
  state.currentCategory = categoryId;
  await setState(phone, state);
  await msg.sendMessage(phone, payload);
}

async function handleBrowsingItems(phone, state, messageType, textBody, interactiveId, interactiveTitle) {
  const logPhone = maskPhone(phone);

  // Handle item selection
  if (interactiveId && interactiveId.startsWith('item_')) {
    const itemId = interactiveId.replace('item_', '');
    return await selectItem(phone, state, itemId);
  }

  // Handle sub-category selection (from burgers/chinese sub-cat list while in BROWSING_ITEMS)
  if (interactiveId && interactiveId.startsWith('cat_')) {
    const categoryId = interactiveId.replace('cat_', '');
    return await showCategoryItems(phone, state, categoryId);
  }

  // Free text
  if (textBody) {
    await msg.sendMessage(phone, msg.tapPromptMessage());
  }
}

async function selectItem(phone, state, itemId) {
  const logPhone = maskPhone(phone);
  const allItems = await menu.getMenuByCategory(state.currentCategory);
  const itemVariants = allItems.filter((i) => i.item_id === itemId && i.in_stock);

  if (itemVariants.length === 0) {
    await msg.sendMessage(phone, {
      type: 'text',
      text: { preview_url: false, body: `😕 This item is no longer available. Please pick another!` },
    });
    return;
  }

  const baseItem = itemVariants[0];

  // Check if item has variants
  const hasMultipleVariants = itemVariants.length > 1 && itemVariants.some((v) => v.variant);

  if (hasMultipleVariants) {
    // Store item and ask for variant
    state.currentItem = {
      item_id: itemId,
      item_name: baseItem.item_name,
      category: state.currentCategory,
      variants: itemVariants.map((v) => ({
        variant: v.variant,
        price: v.price,
      })),
    };

    // Filter out duplicates and items without variant label
    const uniqueVariants = [];
    const seen = new Set();
    for (const v of state.currentItem.variants) {
      if (v.variant && !seen.has(v.variant)) {
        seen.add(v.variant);
        uniqueVariants.push(v);
      }
    }
    state.currentItem.variants = uniqueVariants;

    console.log(`[STATE] ${logPhone} → AWAITING_VARIANT (${baseItem.item_name})`);
    state.state = 'AWAITING_VARIANT';
    await setState(phone, state);
    await msg.sendMessage(phone, msg.variantPromptPayload(baseItem.item_name, uniqueVariants));
    return;
  }

  // Single variant or no variant — check for fried chicken seasoning
  if (state.currentCategory === 'fried_chicken') {
    state.currentItem = {
      item_id: itemId,
      item_name: baseItem.item_name,
      category: state.currentCategory,
      price: baseItem.price,
    };
    console.log(`[STATE] ${logPhone} → AWAITING_SEASONING (${baseItem.item_name})`);
    state.state = 'AWAITING_SEASONING';
    await setState(phone, state);
    await msg.sendMessage(phone, msg.seasoningPromptPayload(baseItem.item_name));
    return;
  }

  // Direct add to cart
  const cartItem = {
    name: baseItem.item_id,
    displayName: baseItem.item_name,
    price: baseItem.price,
    category: state.currentCategory,
    variant: baseItem.variant || null,
  };

  state.cart = addToCart(state.cart, cartItem);
  const total = cartTotal(state.cart);

  console.log(`[STATE] ${logPhone} → ITEM_ADDED (${baseItem.item_name} ₹${baseItem.price})`);
  state.state = 'ITEM_ADDED';
  state.currentItem = null;
  await setState(phone, state);
  await msg.sendMessage(phone, msg.itemAddedMessage(baseItem.item_name, baseItem.price, total));
}

async function handleAwaitingVariant(phone, state, messageType, textBody, interactiveId, interactiveTitle) {
  const logPhone = maskPhone(phone);
  const currentItem = state.currentItem;

  if (!currentItem) {
    state.state = 'BROWSING_CATEGORIES';
    await setState(phone, state);
    const categories = await menu.getAllCategories();
    await msg.sendMessage(phone, msg.categoryListPayload(categories));
    return;
  }

  // Handle variant selection (from button or list)
  let selectedVariant = null;

  if (interactiveId && interactiveId.startsWith('var_')) {
    const variantKey = interactiveId.replace('var_', '');
    selectedVariant = currentItem.variants.find(
      (v) => v.variant.toLowerCase() === variantKey.toLowerCase() || v.variant === variantKey
    );
  }

  if (!selectedVariant) {
    await msg.sendMessage(phone, msg.tapPromptMessage());
    return;
  }

  const displayName = `${currentItem.item_name} (${selectedVariant.variant})`;

  // Check if fried chicken category for seasoning
  if (currentItem.category === 'fried_chicken') {
    state.currentItem = {
      ...currentItem,
      selectedVariant: selectedVariant.variant,
      price: selectedVariant.price,
    };
    console.log(`[STATE] ${logPhone} → AWAITING_SEASONING (${displayName})`);
    state.state = 'AWAITING_SEASONING';
    await setState(phone, state);
    await msg.sendMessage(phone, msg.seasoningPromptPayload(displayName));
    return;
  }

  // Add to cart
  const cartItem = {
    name: currentItem.item_id,
    displayName,
    price: selectedVariant.price,
    category: currentItem.category,
    variant: selectedVariant.variant,
  };

  state.cart = addToCart(state.cart, cartItem);
  const total = cartTotal(state.cart);

  console.log(`[STATE] ${logPhone} → ITEM_ADDED (${displayName} ₹${selectedVariant.price})`);
  state.state = 'ITEM_ADDED';
  state.currentItem = null;
  await setState(phone, state);
  await msg.sendMessage(phone, msg.itemAddedMessage(displayName, selectedVariant.price, total));
}

async function handleAwaitingSeasoning(phone, state, messageType, textBody, interactiveId) {
  const logPhone = maskPhone(phone);
  const currentItem = state.currentItem;

  if (!currentItem) {
    state.state = 'BROWSING_CATEGORIES';
    await setState(phone, state);
    return;
  }

  let seasoning = null;

  if (interactiveId === 'season_periperi') seasoning = 'Periperi';
  else if (interactiveId === 'season_lemonchilli') seasoning = 'Lemon Chilli';
  else if (interactiveId === 'season_none') seasoning = null;
  else {
    await msg.sendMessage(phone, msg.tapPromptMessage());
    return;
  }

  const baseName = currentItem.selectedVariant
    ? `${currentItem.item_name} (${currentItem.selectedVariant})`
    : currentItem.item_name;

  const displayName = seasoning ? `${baseName} + ${seasoning}` : baseName;
  const price = currentItem.price || currentItem.variants?.[0]?.price || 0;

  const cartItem = {
    name: currentItem.item_id,
    displayName,
    price,
    category: currentItem.category,
    variant: currentItem.selectedVariant || null,
  };

  state.cart = addToCart(state.cart, cartItem);
  const total = cartTotal(state.cart);

  console.log(`[STATE] ${logPhone} → ITEM_ADDED (${displayName} ₹${price})`);
  state.state = 'ITEM_ADDED';
  state.currentItem = null;
  await setState(phone, state);
  await msg.sendMessage(phone, msg.itemAddedMessage(displayName, price, total));
}

async function handleItemAdded(phone, state, messageType, textBody, interactiveId) {
  const logPhone = maskPhone(phone);

  if (interactiveId === 'add_more') {
    console.log(`[STATE] ${logPhone} → BROWSING_CATEGORIES (add more)`);
    state.state = 'BROWSING_CATEGORIES';
    await setState(phone, state);
    const categories = await menu.getAllCategories();
    await msg.sendMessage(phone, msg.categoryListPayload(categories));
    return;
  }

  if (interactiveId === 'checkout') {
    return await showCheckout(phone, state);
  }

  // Free text
  if (textBody) {
    await msg.sendMessage(phone, msg.tapPromptMessage());
  }
}

async function showCheckout(phone, state) {
  const logPhone = maskPhone(phone);

  if (state.cart.length === 0) {
    await msg.sendMessage(phone, msg.emptyCartMessage());
    return;
  }

  // Build missing categories for "forgot nudge"
  const cartCategories = new Set(state.cart.map((i) => menu.getTopLevelForCategory(i.category)));
  const allTopLevel = menu.TOP_LEVEL_CATEGORIES;
  const missingCategories = allTopLevel
    .filter((cat) => !cartCategories.has(cat.id))
    .map((cat) => cat.display);

  const total = cartTotal(state.cart);

  console.log(`[STATE] ${logPhone} → CHECKOUT`);
  state.state = 'CHECKOUT';
  await setState(phone, state);
  await msg.sendMessage(
    phone,
    msg.cartSummaryMessage(state.cart, total, missingCategories, state.forgotNudgeSent)
  );

  state.forgotNudgeSent = true;
  await setState(phone, state);
}

async function handleCheckout(phone, state, messageType, textBody, interactiveId) {
  const logPhone = maskPhone(phone);

  if (interactiveId === 'add_more' || interactiveId === 'add_something') {
    console.log(`[STATE] ${logPhone} → BROWSING_CATEGORIES (add more from checkout)`);
    state.state = 'BROWSING_CATEGORIES';
    await setState(phone, state);
    const categories = await menu.getAllCategories();
    await msg.sendMessage(phone, msg.categoryListPayload(categories));
    return;
  }

  if (interactiveId === 'confirm_order') {
    return await showDeliveryZones(phone, state);
  }

  // Free text
  if (textBody) {
    await msg.sendMessage(phone, msg.tapPromptMessage());
  }
}

async function showDeliveryZones(phone, state) {
  const logPhone = maskPhone(phone);
  const zones = (process.env.DELIVERY_ZONES || 'MIT Hostels,KMC Hostels,TAPMI Campus,Manipal Town,Udupi Town,Vidyaratna Nagar,End Point,Other').split(',');

  console.log(`[STATE] ${logPhone} → AWAITING_LOCATION_ZONE`);
  state.state = 'AWAITING_LOCATION_ZONE';
  await setState(phone, state);
  await msg.sendMessage(phone, msg.locationZoneListPayload(zones));
}

async function handleAwaitingLocationZone(phone, state, messageType, textBody, interactiveId, interactiveTitle) {
  const logPhone = maskPhone(phone);

  if (interactiveId && interactiveId.startsWith('zone_')) {
    const zones = (process.env.DELIVERY_ZONES || 'MIT Hostels,KMC Hostels,TAPMI Campus,Manipal Town,Udupi Town,Vidyaratna Nagar,End Point,Other').split(',');
    const zoneIndex = parseInt(interactiveId.replace('zone_', ''), 10);
    const zone = zones[zoneIndex] || interactiveTitle || 'Unknown';

    state.deliveryZone = zone;
    console.log(`[STATE] ${logPhone} → AWAITING_ROOM (zone: ${zone})`);
    state.state = 'AWAITING_ROOM';
    await setState(phone, state);
    await msg.sendMessage(phone, msg.roomRequestMessage(zone));
    return;
  }

  // Free text
  if (textBody) {
    await msg.sendMessage(phone, msg.tapPromptMessage());
  }
}

async function handleAwaitingRoom(phone, state, messageType, textBody) {
  const logPhone = maskPhone(phone);

  if (!textBody || textBody.trim().length === 0) {
    await msg.sendMessage(phone, {
      type: 'text',
      text: { preview_url: false, body: `Please type your room number or building name 📝` },
    });
    return;
  }

  state.roomDetail = textBody.trim();
  const orderId = generateOrderId();
  state.orderId = orderId;

  const total = cartTotal(state.cart);
  const paymentLink = await createPaymentLink(orderId, total, phone);

  // Log order to Google Sheets
  await sheets.logOrder({
    orderId,
    phone,
    cart: state.cart,
    total,
    zone: state.deliveryZone,
    room: state.roomDetail,
    paymentLink,
  });

  // Send order summary to customer
  await msg.sendMessage(
    phone,
    msg.orderSummaryWithPaymentMessage(
      state.cart,
      total,
      state.deliveryZone,
      state.roomDetail,
      orderId,
      paymentLink
    )
  );

  // Send kitchen notification (pending)
  const ownerPhone = process.env.OWNER_WHATSAPP;
  if (ownerPhone) {
    await msg.sendMessage(
      ownerPhone,
      msg.ownerPendingAlertMessage(orderId, phone, state.cart, total, state.deliveryZone, state.roomDetail)
    );
  }

  console.log(`[STATE] ${logPhone} → AWAITING_PAYMENT (order: ${orderId})`);
  state.state = 'AWAITING_PAYMENT';
  await setState(phone, state);
}

// ─── Payment confirmation (Razorpay webhook or cash) ─────────────

async function handlePaymentConfirmed(orderId) {
  console.log(`[PAYMENT] Confirmed for order ${orderId}`);

  // Update Google Sheets
  await sheets.updateOrderStatus(orderId, 'PAID');

  // Find the order data
  const orderData = await sheets.getOrderByOrderId(orderId);
  if (!orderData) {
    console.error(`[PAYMENT] Order ${orderId} not found in Sheets`);
    return;
  }

  const phone = orderData.phone;
  const deliveryTime = await menu.getDeliveryTime();

  // Send confirmation to customer
  await msg.sendMessage(phone, msg.orderConfirmedMessage(deliveryTime));

  // Send kitchen notification (start cooking)
  const ownerPhone = process.env.OWNER_WHATSAPP;
  if (ownerPhone) {
    const cart = JSON.parse(orderData.itemsJson || '[]');
    await msg.sendMessage(
      ownerPhone,
      msg.ownerConfirmedAlertMessage(
        orderId,
        phone,
        cart,
        orderData.total,
        orderData.zone,
        orderData.room
      )
    );
  }

  // Clear state, preserve lastSeen
  await clearState(phone);
}

async function handleCashConfirm(phone, state) {
  const logPhone = maskPhone(phone);
  const orderId = state.orderId;

  if (!orderId) {
    await msg.sendMessage(phone, msg.errorFallbackMessage());
    return;
  }

  console.log(`[PAYMENT] Cash confirmed for order ${orderId} by ${logPhone}`);

  // Update Google Sheets
  await sheets.updateOrderStatus(orderId, 'COD');

  const deliveryTime = await menu.getDeliveryTime();

  // Send confirmation to customer
  await msg.sendMessage(phone, msg.cashConfirmMessage(deliveryTime));

  // Send kitchen notification (start cooking)
  const ownerPhone = process.env.OWNER_WHATSAPP;
  if (ownerPhone) {
    await msg.sendMessage(
      ownerPhone,
      msg.ownerConfirmedAlertMessage(
        orderId,
        phone,
        state.cart,
        cartTotal(state.cart),
        state.deliveryZone,
        state.roomDetail
      )
    );
  }

  // Clear state
  await clearState(phone);
}

module.exports = { handleMessage, handlePaymentConfirmed };
