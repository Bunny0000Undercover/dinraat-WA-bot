# 🌙 Din Raat Bites — WhatsApp Order Bot

Production-ready WhatsApp ordering chatbot for **Din Raat Bites**, Manipal/Udupi's 24/7 Halal cloud kitchen.

Handles the full order flow — menu browsing, cart management, delivery location, and order confirmation — via the **Meta Cloud API** (WhatsApp Business Platform). Deployed on **Vercel** with serverless functions.

**No third-party bot platforms.** Everything is custom Node.js.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Express.js (via Vercel serverless) |
| Deployment | Vercel |
| WhatsApp | Meta Cloud API (Graph API v19+) |
| Conversation State | Vercel KV (Redis) |
| Menu & Config CMS | Google Sheets API v4 |
| Order Logging | Google Sheets |
| Payment | Razorpay (stubbed — ready to activate) |

---

## Prerequisites

- **Node.js 20+** — [Download](https://nodejs.org/)
- **Vercel CLI** — `npm i -g vercel`
- **GitHub account** — for source control
- **Meta Developer account** — for WhatsApp Business API
- **Google Cloud service account** — for Sheets API
- (Optional) **Razorpay account** — for online payments

---

## 1. Meta App Setup

### Step-by-Step

1. Go to [developers.facebook.com](https://developers.facebook.com/) → **Create App**
2. Choose **Business** type → name it `Din Raat Bites Bot`
3. On the app dashboard, click **Add Product** → select **WhatsApp**
4. Under **WhatsApp > API Setup**:
   - Note your **Phone Number ID** → put in `WHATSAPP_PHONE_NUMBER_ID`
   - Generate a **Permanent Access Token** (or use the temporary one for testing) → put in `WHATSAPP_TOKEN`
5. Under **WhatsApp > Configuration**:
   - **Webhook URL**: `https://your-vercel-url.vercel.app/webhook`
   - **Verify Token**: Set any random string (e.g., `dinraat-verify-2024`) → put in `WEBHOOK_VERIFY_TOKEN`
   - **Webhook fields**: Subscribe to `messages`
6. Add a test phone number (your personal number) for development

> ⚠️ For production, you'll need to verify your business and get a permanent token. The temporary token expires every 24 hours.

---

## 2. Google Sheets Setup

### Create the Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com) → create a new spreadsheet
2. Name it `Din Raat Bites - Bot Data`
3. Create **3 tabs**:

#### Tab: `Menu`
Columns: `category` | `category_display` | `item_id` | `item_name` | `list_display` | `variant` | `price` | `in_stock` | `sort_order`

Populate from the seed data in `data/menu-seed.json`.

#### Tab: `Config`
| Key | Value |
|---|---|
| `SURGE_MODE` | `FALSE` |
| `KITCHEN_OPEN` | `TRUE` |
| `EST_DELIVERY_TIME` | `25–35 mins` |

#### Tab: `Orders`
Columns: `timestamp` | `order_id` | `customer_phone` | `items_json` | `total` | `zone` | `room` | `payment_status` | `razorpay_link`

### Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → enable **Google Sheets API**
3. Create a **Service Account** → download the JSON key
4. Copy:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
5. **Share the spreadsheet** with the service account email (Editor role)
6. Copy the spreadsheet ID from the URL → `SPREADSHEET_ID`

---

## 3. Vercel KV Setup

1. In your Vercel dashboard, go to **Storage** → **Create Database** → **KV**
2. Name it `dinraat-state`
3. Link it to your project
4. The following env vars are auto-populated:
   - `KV_URL`
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`

---

## 4. Deploy

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/dinraat-bot.git
cd dinraat-bot
npm install

# Local development
cp .env.example .env
# Fill in all values in .env
vercel dev

# Deploy to production
git push origin main
# In Vercel dashboard: connect repo → add all env vars → deploy
```

After deployment:
1. Copy your production URL (e.g., `https://dinraat-bot.vercel.app`)
2. Paste it into Meta webhook config: `https://dinraat-bot.vercel.app/webhook`
3. Meta will verify the webhook → you'll see `Verification successful` in logs

---

## 5. Owner Guide: Surge Mode

When order volume is high and deliveries are taking longer:

1. Open the Google Sheet → `Config` tab
2. Change `SURGE_MODE` from `FALSE` to `TRUE`
3. Takes effect within **60 seconds**
4. Every customer (new and returning) will see: _"⚠️ High order volume right now. Deliveries may take 45–60 mins."_

To disable: change back to `FALSE`.

---

## 6. Owner Guide: Pause Orders

To temporarily stop accepting orders:

1. Open the Google Sheet → `Config` tab
2. Change `KITCHEN_OPEN` from `TRUE` to `FALSE`
3. Takes effect within **60 seconds**
4. Customers will see: _"😴 We're taking a short break right now..."_

To resume: change back to `TRUE`.

---

## 7. Owner Guide: Stock Management

To mark an item as unavailable:

1. Open the Google Sheet → `Menu` tab
2. Find the item → change `in_stock` from `TRUE` to `FALSE`
3. Disappears from menu within **5 minutes**

To restock: change back to `TRUE`.

---

## 8. Owner Guide: Update Prices

1. Open the Google Sheet → `Menu` tab
2. Edit the `price` column for the item
3. Takes effect within **5 minutes**

---

## 9. Activating Razorpay

When you're ready for online payments:

1. Create a [Razorpay](https://razorpay.com/) account
2. Get your **Key ID** and **Key Secret** from Dashboard → Settings → API Keys
3. In Vercel dashboard, add env vars:
   - `RAZORPAY_KEY_ID` = your key ID
   - `RAZORPAY_KEY_SECRET` = your key secret
4. Open `lib/razorpay.js` → uncomment the 8 lines in `createPaymentLink()`
5. Push to GitHub → Vercel auto-deploys
6. Set up Razorpay webhook:
   - URL: `https://your-vercel-url.vercel.app/webhook?source=razorpay`
   - Events: `payment.captured`, `payment_link.paid`

Until Razorpay is activated, the bot gracefully falls back to **cash on delivery** (customer replies `CONFIRM`).

---

## Testing

### Dev-only test endpoint

Manually trigger payment confirmation (development only):

```
GET /webhook?order_id=DRB-0330-4821
```

This endpoint is blocked in production (`NODE_ENV=production`).

---

## Conversation Flow (9 Messages)

```
Customer → Hi
Bot → Welcome + Browse Menu button         (Message 1)
Customer → Browse Menu
Bot → Category list                         (Message 2)
Customer → Picks category
Bot → Item list                             (Message 3)
Customer → Picks item
Bot → [Variant picker if needed]            (Variant step)
Bot → Item added + Add more / Checkout      (Message 4)
Customer → Checkout
Bot → Cart summary + forgot nudge           (Message 5)
Customer → Confirm order
Bot → Delivery zone picker                  (Message 6)
Customer → Picks zone
Bot → Room/address request                  (Message 7)
Customer → Types room
Bot → Order summary + payment link          (Message 8)
[Payment webhook]
Bot → Order confirmed                       (Message 9)
```

---

## Architecture

```
WhatsApp → Meta Cloud API → POST /webhook → flow.js → Vercel KV (state)
                                                     → Google Sheets (menu + orders)
                                                     → Razorpay (payment links)
                                                     → WhatsApp API (replies)
```

---

*Din Raat Bites | 8105967010 / 9353208019 | @dinraat.bites | dinraatbites@gmail.com*
