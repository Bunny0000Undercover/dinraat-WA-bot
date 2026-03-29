// Menu CMS — Fetches, caches, and serves menu from Google Sheets
// Falls back to data/menu-seed.json if Sheets is unreachable

const { google } = require('googleapis');
const path = require('path');

let sheetsClient = null;

// ─── Cache ────────────────────────────────────────────────────────
let menuCache = null;
let menuCacheTime = 0;
const MENU_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 60 * 1000; // 60 seconds

// ─── Category display mapping ────────────────────────────────────
const CATEGORY_DISPLAY = {
  fries: '🍟 French Fries',
  wings: '🍗 Wings Things',
  strips: '🍗 Chicken Strips',
  popcorn: '🍿 Chicken Popcorn',
  fried_chicken: '🍗 Fried Chicken',
  wraps: '🌯 Wraps',
  paneer_shots: '🧀 Creamy Paneer Shots',
  burgers: '🍔 Burgers',
  burgers_veg: '🍔 Veg Burgers',
  burgers_nonveg: '🍔 Non-Veg (No Cheese)',
  burgers_cheese: '🍔 Non-Veg with Cheese',
  burgers_steak: '🍔 Steak Burgers',
  burgers_double: '🍔 Double Patty',
  burgers_signature: '🍔 Signature',
  chinese: '🥢 Chinese',
  chinese_soup: '🍲 Soups',
  chinese_veg: '🥗 Veg Starters',
  chinese_nonveg: '🍗 Non-Veg Starters',
  chinese_rice: '🍚 Fried Rice',
  chinese_noodles: '🍜 Noodles',
  thai: '🍛 Thai Curry',
  indian_rice: '🍚 Rice & Biryani',
  kebabs: '🍢 Kebabs',
  mutton: '🥩 Mutton Special',
};

// Top-level categories shown in category picker (24 chars max for list row titles)
const TOP_LEVEL_CATEGORIES = [
  { id: 'fries', display: '🍟 French Fries' },
  { id: 'wings', display: '🍗 Wings Things' },
  { id: 'strips', display: '🍗 Chicken Strips' },
  { id: 'popcorn', display: '🍿 Chicken Popcorn' },
  { id: 'fried_chicken', display: '🍗 Fried Chicken' },
  { id: 'wraps', display: '🌯 Wraps' },
  { id: 'paneer_shots', display: '🧀 Creamy Paneer Shots' },
  { id: 'burgers', display: '🍔 Burgers' },
  { id: 'chinese', display: '🥢 Chinese' },
  { id: 'thai', display: '🍛 Thai Curry' },
  { id: 'indian_rice', display: '🍚 Rice & Biryani' },
  { id: 'kebabs', display: '🍢 Kebabs' },
  { id: 'mutton', display: '🥩 Mutton Special' },
];

// Sub-category groups
const BURGER_SUBCATEGORIES = [
  { id: 'burgers_veg', display: 'Veg Burgers' },
  { id: 'burgers_nonveg', display: 'Non-Veg (No Cheese)' },
  { id: 'burgers_cheese', display: 'Non-Veg with Cheese' },
  { id: 'burgers_steak', display: 'Steak Burgers' },
  { id: 'burgers_double', display: 'Double Patty' },
  { id: 'burgers_signature', display: 'Signature' },
];

const CHINESE_SUBCATEGORIES = [
  { id: 'chinese_soup', display: '🍲 Soups' },
  { id: 'chinese_veg', display: '🥗 Veg Starters' },
  { id: 'chinese_nonveg', display: '🍗 Non-Veg Starters' },
  { id: 'chinese_rice', display: '🍚 Fried Rice' },
  { id: 'chinese_noodles', display: '🍜 Noodles' },
];

// ─── Google Sheets client ────────────────────────────────────────

async function getSheets() {
  if (sheetsClient) return sheetsClient;

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// ─── Truncate helper ─────────────────────────────────────────────

function truncateForList(str) {
  return str.length > 24 ? str.slice(0, 21) + '...' : str;
}

// ─── Load menu from Sheets or fallback ───────────────────────────

async function loadMenu() {
  const now = Date.now();
  if (menuCache && now - menuCacheTime < MENU_CACHE_TTL) {
    return menuCache;
  }

  const sheets = await getSheets();
  if (sheets && process.env.SPREADSHEET_ID) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'Menu!A:I',
      });

      const rows = res.data.values || [];
      if (rows.length > 1) {
        const headers = rows[0];
        const items = rows.slice(1).map((row) => ({
          category: row[0] || '',
          category_display: row[1] || '',
          item_id: row[2] || '',
          item_name: row[3] || '',
          list_display: row[4] || '',
          variant: row[5] || '',
          price: parseInt(row[6], 10) || 0,
          in_stock: (row[7] || '').toUpperCase() === 'TRUE',
          sort_order: parseInt(row[8], 10) || 0,
        }));

        menuCache = items;
        menuCacheTime = now;
        return items;
      }
    } catch (err) {
      console.error(`[Menu] Sheets fetch failed at ${new Date().toISOString()}:`, err.message);
    }
  }

  // Fallback to seed data
  try {
    const seedPath = path.resolve(__dirname, '..', 'data', 'menu-seed.json');
    const seedData = require(seedPath);
    menuCache = seedData;
    menuCacheTime = now;
    console.log('[Menu] Using menu-seed.json fallback');
    return seedData;
  } catch (err) {
    console.error('[Menu] Failed to load menu-seed.json:', err.message);
    return [];
  }
}

// ─── Load config from Sheets ─────────────────────────────────────

async function loadConfig() {
  const now = Date.now();
  if (configCache && now - configCacheTime < CONFIG_CACHE_TTL) {
    return configCache;
  }

  const sheets = await getSheets();
  if (sheets && process.env.SPREADSHEET_ID) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'Config!A:B',
      });

      const rows = res.data.values || [];
      const config = {};
      for (const row of rows) {
        if (row[0]) config[row[0]] = row[1] || '';
      }

      configCache = config;
      configCacheTime = now;
      return config;
    } catch (err) {
      console.error(`[Menu] Config fetch failed at ${new Date().toISOString()}:`, err.message);
    }
  }

  // Defaults
  return {
    SURGE_MODE: 'FALSE',
    KITCHEN_OPEN: 'TRUE',
    EST_DELIVERY_TIME: '25–35 mins',
  };
}

// ─── Public API ──────────────────────────────────────────────────

async function getAllCategories() {
  const menu = await loadMenu();
  const inStockCategories = new Set();

  for (const item of menu) {
    if (item.in_stock) {
      inStockCategories.add(item.category);
    }
  }

  // For top-level, check if the category itself or any sub-category has stock
  return TOP_LEVEL_CATEGORIES.filter((cat) => {
    if (cat.id === 'burgers') {
      return BURGER_SUBCATEGORIES.some((sub) => inStockCategories.has(sub.id));
    }
    if (cat.id === 'chinese') {
      return CHINESE_SUBCATEGORIES.some((sub) => inStockCategories.has(sub.id));
    }
    return inStockCategories.has(cat.id);
  });
}

async function getMenuByCategory(category) {
  const menu = await loadMenu();
  return menu
    .filter((item) => item.category === category && item.in_stock)
    .sort((a, b) => a.sort_order - b.sort_order);
}

async function getItemById(itemId) {
  const menu = await loadMenu();
  return menu.filter((item) => item.item_id === itemId && item.in_stock);
}

async function getItemVariants(itemId) {
  const menu = await loadMenu();
  return menu.filter((item) => item.item_id === itemId && item.in_stock && item.variant);
}

async function getSurgeMode() {
  const config = await loadConfig();
  return config.SURGE_MODE === 'TRUE';
}

async function isKitchenOpen() {
  const config = await loadConfig();
  return config.KITCHEN_OPEN !== 'FALSE';
}

async function getDeliveryTime() {
  const config = await loadConfig();
  return config.EST_DELIVERY_TIME || '25–35 mins';
}

function getBurgerSubcategories() {
  return BURGER_SUBCATEGORIES;
}

function getChineseSubcategories() {
  return CHINESE_SUBCATEGORIES;
}

function getCategoryDisplay(categoryId) {
  return CATEGORY_DISPLAY[categoryId] || categoryId;
}

function getAllCategoryIds() {
  // Return all leaf-level category IDs (for the "forgot nudge" feature)
  const ids = [];
  for (const cat of TOP_LEVEL_CATEGORIES) {
    if (cat.id === 'burgers') {
      ids.push(...BURGER_SUBCATEGORIES.map((s) => s.id));
    } else if (cat.id === 'chinese') {
      ids.push(...CHINESE_SUBCATEGORIES.map((s) => s.id));
    } else {
      ids.push(cat.id);
    }
  }
  return ids;
}

function getTopLevelForCategory(leafCategory) {
  // Map leaf category back to top-level for "forgot nudge"
  if (leafCategory.startsWith('burgers_')) return 'burgers';
  if (leafCategory.startsWith('chinese_')) return 'chinese';
  return leafCategory;
}

module.exports = {
  getAllCategories,
  getMenuByCategory,
  getItemById,
  getItemVariants,
  getSurgeMode,
  isKitchenOpen,
  getDeliveryTime,
  getBurgerSubcategories,
  getChineseSubcategories,
  getCategoryDisplay,
  truncateForList,
  TOP_LEVEL_CATEGORIES,
  BURGER_SUBCATEGORIES,
  CHINESE_SUBCATEGORIES,
  getAllCategoryIds,
  getTopLevelForCategory,
};
