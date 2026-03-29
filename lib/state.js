// Vercel KV conversation state manager
// Falls back to in-memory Map if KV is unreachable

let kv = null;
let kvAvailable = true;

// In-memory fallback (won't persist across cold starts)
const memoryStore = new Map();

const STATE_TTL = 2 * 60 * 60; // 2 hours in seconds

const DEFAULT_STATE = {
  phone: null,
  state: 'IDLE',
  cart: [],
  currentCategory: null,
  currentItem: null,
  deliveryZone: null,
  roomDetail: null,
  forgotNudgeSent: false,
  isReturningCustomer: false,
  lastSeen: null,
  messageCount: 0,
  lastMessageTime: null,
  orderId: null,
};

async function getKV() {
  if (kv) return kv;
  if (!kvAvailable) return null;
  try {
    const vercelKV = require('@vercel/kv');
    kv = vercelKV.kv;
    return kv;
  } catch (err) {
    console.warn('[State] Vercel KV unavailable, using in-memory fallback:', err.message);
    kvAvailable = false;
    return null;
  }
}

function stateKey(phone) {
  return `drb:state:${phone}`;
}

function lastSeenKey(phone) {
  return `drb:lastseen:${phone}`;
}

async function getState(phone) {
  const store = await getKV();
  let data = null;

  if (store) {
    try {
      data = await store.get(stateKey(phone));
    } catch (err) {
      console.error('[State] KV read error:', err.message);
    }
  }

  if (!data) {
    data = memoryStore.get(stateKey(phone)) || null;
  }

  if (!data) {
    // Check if returning customer
    let lastSeen = null;
    if (store) {
      try {
        lastSeen = await store.get(lastSeenKey(phone));
      } catch (err) { /* ignore */ }
    }
    if (!lastSeen) {
      lastSeen = memoryStore.get(lastSeenKey(phone)) || null;
    }

    const isReturning = lastSeen
      ? (Date.now() - new Date(lastSeen).getTime()) < 12 * 60 * 60 * 1000
      : false;

    return {
      ...DEFAULT_STATE,
      phone,
      isReturningCustomer: isReturning,
      lastSeen,
    };
  }

  return data;
}

async function setState(phone, stateData) {
  const data = { ...stateData, phone };
  const store = await getKV();

  if (store) {
    try {
      await store.set(stateKey(phone), data, { ex: STATE_TTL });
    } catch (err) {
      console.error('[State] KV write error, falling back to memory:', err.message);
      memoryStore.set(stateKey(phone), data);
    }
  } else {
    memoryStore.set(stateKey(phone), data);
  }
}

async function clearState(phone) {
  const store = await getKV();

  // Save lastSeen timestamp for returning customer detection
  const now = new Date().toISOString();
  if (store) {
    try {
      await store.del(stateKey(phone));
      await store.set(lastSeenKey(phone), now, { ex: 24 * 60 * 60 }); // 24h TTL
    } catch (err) {
      console.error('[State] KV clear error:', err.message);
      memoryStore.delete(stateKey(phone));
      memoryStore.set(lastSeenKey(phone), now);
    }
  } else {
    memoryStore.delete(stateKey(phone));
    memoryStore.set(lastSeenKey(phone), now);
  }
}

function maskPhone(phone) {
  if (!phone || phone.length < 4) return 'XXXX';
  return phone.slice(-4) + 'XXXX';
}

module.exports = { getState, setState, clearState, maskPhone, DEFAULT_STATE };
