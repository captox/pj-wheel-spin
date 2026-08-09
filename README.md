# Free Spin Wheel

A small server-controlled promotional spin wheel intended for a **free, no-purchase-required** promotion. It uses only Node.js built-ins, including Node's SQLite module, so there are no npm dependencies to install.

## What is included

- Mobile-friendly animated wheel
- Server-side cryptographic random prize selection
- Explicit prize odds display
- One completed spin per unique `userId`
- Signed expiring spin URLs
- Unique claim codes for winners
- SQLite persistence using Node.js `node:sqlite`
- Password-protected admin dashboard
- Mark-winner-as-claimed action
- Messenger webhook verification endpoint
- Optional "message `spin` → receive Spin Now button" Messenger flow

## Default prize configuration

Edit `config.js` to change it.

| Result | Odds | Expected payout contribution |
|---|---:|---:|
| No prize | 67.39% | ₱0.00 |
| ₱10 | 15% | ₱1.50 |
| ₱20 | 10% | ₱2.00 |
| ₱50 | 5% | ₱2.50 |
| ₱100 | 2% | ₱2.00 |
| ₱200 | 0.5% | ₱1.00 |
| ₱1,000 | 0.1% | ₱1.00 |
| ₱5,000 | 0.01% | ₱0.50 |
| **Total expected payout** | 100% | **₱10.50/spin** |

Total probability of receiving a cash prize is **32.61%**. These are sample economics, not a recommendation. Make sure the displayed odds and your actual config always match.

## 1. Install

Requires **Node.js 22.5+**.

```bash
cp .env.example .env
```

There are no third-party npm dependencies.

Set strong values in `.env` for `TOKEN_SECRET`, `BOT_SECRET`, and `ADMIN_PASSWORD`.

A quick way to generate a secret on macOS/Linux is:

```bash
openssl rand -hex 32
```

## 2. Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

The bare home page will not allow a spin because every player needs a signed link.

## 3. Create a test player link

```bash
npm run create-link -- test-user-001
```

Copy the URL printed by the command and open it in your browser. Re-opening or re-minting a link for `test-user-001` will show the same saved result after that user has spun.

Use a different ID to simulate a different person:

```bash
npm run create-link -- test-user-002
```

## 4. Admin dashboard

Visit:

```text
http://localhost:3000/admin
```

Your browser will ask for Basic Auth credentials:

- Username: `admin`
- Password: whatever you set as `ADMIN_PASSWORD`

The dashboard shows completed spins, winners, payout total, claim codes, and whether a winning code has been claimed.

## 5. Integrate with another bot/CRM

Call:

```http
POST /api/create-spin-link
X-Bot-Secret: YOUR_BOT_SECRET
Content-Type: application/json

{"userId":"YOUR-UNIQUE-USER-ID"}
```

The API returns:

```json
{"url":"https://your-domain.example/?t=SIGNED_TOKEN"}
```

Send that URL to the user.

## 6. Messenger integration

The included `/webhook` route contains a minimal Messenger example:

1. Meta sends webhook events to `https://your-domain.example/webhook`.
2. When the received text is exactly `spin`, the app uses the sender's Page-scoped ID as the unique `userId`.
3. It signs a personal spin URL.
4. It sends a Messenger button that opens the wheel page.

Set these values in `.env`:

```text
META_VERIFY_TOKEN=your-own-verification-string
META_PAGE_ACCESS_TOKEN=your-page-access-token
META_PAGE_ID=your-page-id
META_GRAPH_VERSION=vXX.X
PUBLIC_BASE_URL=https://your-public-https-domain.example
```

Use the Graph API version currently enabled/supported for your Meta app. The code intentionally does not hardcode a version because Meta versions the Graph API over time.

In your Meta app configuration, use:

```text
Callback URL: https://your-public-https-domain.example/webhook
Verify token: the exact META_VERIFY_TOKEN value from your .env
```

Subscribe the Page/app to the messaging webhook fields required by your Messenger setup.

## 7. Deploying

For a first public test, deploy the Node app somewhere that gives you HTTPS and **persistent storage**. SQLite lives at `data/spins.sqlite`, so if your host has an ephemeral filesystem, the spin records can disappear on a restart/redeploy.

For larger traffic, replace SQLite with a hosted database such as PostgreSQL and put the app behind normal production monitoring/backups.

## Security notes

- Never let the browser choose the winning prize.
- Never expose `TOKEN_SECRET`, `BOT_SECRET`, `ADMIN_PASSWORD`, or the Meta Page access token to frontend JavaScript.
- Use HTTPS in production.
- Back up the database.
- Keep the prize rules/odds shown to users synchronized with `config.js`.
- The unique-user rule is only as good as the identity passed to the app. Messenger Page-scoped user IDs are much stronger than IP-address-only checks.
- Before launch, review the promotion rules that apply to your page, platform, and jurisdiction.

## Important design detail

The visible wheel uses equal visual sectors so the labels are readable on a phone. It **does not imply equal odds**. The exact odds are shown directly under the wheel, and the page states that the server selects the result independently of the animation. If you prefer, replace the wheel graphic with a probability-proportional visualization.
