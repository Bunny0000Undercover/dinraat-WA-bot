// Google Sheets order logging & config reader
const { google } = require('googleapis');

let sheetsClient = null;

async function getSheets() {
  if (sheetsClient) return sheetsClient;

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    console.warn('[Sheets] Google credentials not configured');
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function getSpreadsheetId() {
  return process.env.SPREADSHEET_ID;
}

// ─── Order Logging ───────────────────────────────────────────────

async function logOrder({ orderId, phone, cart, total, zone, room, paymentLink }) {
  const sheets = await getSheets();
  if (!sheets) {
    console.error('[Sheets] Cannot log order — Sheets not configured');
    return;
  }

  const timestamp = new Date().toISOString();
  const itemsJson = JSON.stringify(
    cart.map((item) => ({
      name: item.displayName || item.name,
      qty: item.qty,
      price: item.price,
    }))
  );

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Orders!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, orderId, phone, itemsJson, total, zone, room, 'PENDING', paymentLink || '']],
      },
    });
    console.log(`[Sheets] Order ${orderId} logged as PENDING`);
  } catch (err) {
    console.error(`[Sheets] Failed to log order ${orderId}:`, err.message);
  }
}

async function updateOrderStatus(orderId, status) {
  const sheets = await getSheets();
  if (!sheets) {
    console.error('[Sheets] Cannot update order — Sheets not configured');
    return;
  }

  try {
    // Read order_id column (B) to find the row
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Orders!B:B',
    });

    const rows = res.data.values || [];
    let rowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === orderId) {
        rowIndex = i + 1; // Sheets is 1-indexed
        break;
      }
    }

    if (rowIndex === -1) {
      console.error(`[Sheets] Order ${orderId} not found for status update`);
      return;
    }

    // Update only the payment_status cell (column H)
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `Orders!H${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[status]],
      },
    });

    console.log(`[Sheets] Order ${orderId} updated to ${status}`);
  } catch (err) {
    console.error(`[Sheets] Failed to update order ${orderId}:`, err.message);
  }
}

// ─── Find order data by ID (for payment confirmation) ────────────

async function getOrderByOrderId(orderId) {
  const sheets = await getSheets();
  if (!sheets) return null;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Orders!A:I',
    });

    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === orderId) {
        return {
          timestamp: rows[i][0],
          orderId: rows[i][1],
          phone: rows[i][2],
          itemsJson: rows[i][3],
          total: rows[i][4],
          zone: rows[i][5],
          room: rows[i][6],
          paymentStatus: rows[i][7],
          paymentLink: rows[i][8],
        };
      }
    }
    return null;
  } catch (err) {
    console.error(`[Sheets] Failed to find order ${orderId}:`, err.message);
    return null;
  }
}

module.exports = { logOrder, updateOrderStatus, getOrderByOrderId };
