const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { DatabaseSync } = require("node:sqlite");
const { loadEnv } = require("./env");
const { signSpinToken, verifySpinToken, choosePrize, makeClaimCode, publicOdds } = require("./lib");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const TOKEN_SECRET = process.env.TOKEN_SECRET || "dev-token-secret-change-me";
const BOT_SECRET = process.env.BOT_SECRET || "dev-bot-secret-change-me";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const PUBLIC_DIR = path.join(__dirname, "public");

const dbPath = path.join(__dirname, "data", "spins.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS spins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    prize_id TEXT NOT NULL,
    prize_label TEXT NOT NULL,
    amount INTEGER NOT NULL,
    claim_code TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at TEXT
  );
`);

const rateBuckets = new Map();
function allowSpin(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 15;
  const current = rateBuckets.get(ip) || { start: now, count: 0 };
  if (now - current.start >= windowMs) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  rateBuckets.set(ip, current);
  return current.count <= limit;
}
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, value] of rateBuckets) if (value.start < cutoff) rateBuckets.delete(key);
}, 5 * 60_000).unref();

function safeEqualString(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) }));
  res.end(body);
}

function html(res, status, body, extra = {}) {
  res.writeHead(status, securityHeaders({ "Content-Type": "text/html; charset=utf-8", ...extra }));
  res.end(body);
}

function text(res, status, body, extra = {}) {
  res.writeHead(status, securityHeaders({ "Content-Type": "text/plain; charset=utf-8", ...extra }));
  res.end(body);
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'",
    ...extra
  };
}

async function readBody(req, maxBytes = 50_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

function adminAuthorized(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch { return false; }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  return decoded.slice(0, colon) === "admin" && safeEqualString(decoded.slice(colon + 1), ADMIN_PASSWORD);
}

function requireAdmin(req, res) {
  if (adminAuthorized(req)) return true;
  text(res, 401, "Authentication required", { "WWW-Authenticate": 'Basic realm="Spin Admin"' });
  return false;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>\"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
}

function serveStatic(urlPath, res) {
  const map = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "application/javascript; charset=utf-8"]
  };
  const item = map[urlPath];
  if (!item) return false;
  const file = path.join(PUBLIC_DIR, item[0]);
  const body = fs.readFileSync(file);
  res.writeHead(200, securityHeaders({ "Content-Type": item[1], "Content-Length": body.length, "Cache-Control": urlPath === "/" ? "no-store" : "public, max-age=300" }));
  res.end(body);
  return true;
}

async function sendMessengerSpinButton(psid) {
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  const graphVersion = process.env.META_GRAPH_VERSION;
  if (!pageToken || !pageId || !graphVersion) {
    throw new Error("META_PAGE_ACCESS_TOKEN, META_PAGE_ID and META_GRAPH_VERSION must be configured.");
  }

  const token = signSpinToken(psid, TOKEN_SECRET);
  const spinUrl = `${PUBLIC_BASE_URL}/?t=${encodeURIComponent(token)}`;
  const endpoint = `https://graph.facebook.com/${graphVersion}/${pageId}/messages`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${pageToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "🎁 Your free spin is ready. One spin per person. Tap below to play.",
            buttons: [{ type: "web_url", url: spinUrl, title: "🎡 Spin Now", webview_height_ratio: "tall" }]
          }
        }
      }
    })
  });
  if (!response.ok) throw new Error(`Meta API ${response.status}: ${await response.text()}`);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = u.pathname;

    if (req.method === "GET" && serveStatic(pathname, res)) return;

    if (req.method === "GET" && pathname === "/api/odds") {
      return json(res, 200, { prizes: publicOdds() });
    }

    if (req.method === "POST" && pathname === "/api/spin") {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      if (!allowSpin(ip)) return json(res, 429, { error: "Too many requests. Please try again shortly." });
      try {
        const body = await readJson(req);
        const payload = verifySpinToken(body.token, TOKEN_SECRET);
        const userId = payload.sub;
        const prior = db.prepare("SELECT * FROM spins WHERE user_id = ?").get(userId);
        if (prior) {
          return json(res, 200, { alreadySpun: true, prizeId: prior.prize_id, prizeLabel: prior.prize_label, amount: prior.amount, claimCode: prior.claim_code });
        }

        const prize = choosePrize();
        const claimCode = prize.amount > 0 ? makeClaimCode() : null;
        try {
          db.prepare("INSERT INTO spins (user_id, prize_id, prize_label, amount, claim_code) VALUES (?, ?, ?, ?, ?)").run(userId, prize.id, prize.label, prize.amount, claimCode);
        } catch (err) {
          const existing = db.prepare("SELECT * FROM spins WHERE user_id = ?").get(userId);
          if (existing) return json(res, 200, { alreadySpun: true, prizeId: existing.prize_id, prizeLabel: existing.prize_label, amount: existing.amount, claimCode: existing.claim_code });
          throw err;
        }
        return json(res, 200, { alreadySpun: false, prizeId: prize.id, prizeLabel: prize.label, amount: prize.amount, claimCode });
      } catch {
        return json(res, 400, { error: "This spin link is invalid or expired." });
      }
    }

    if (req.method === "POST" && pathname === "/api/create-spin-link") {
      if (!safeEqualString(req.headers["x-bot-secret"], BOT_SECRET)) return json(res, 401, { error: "Unauthorized" });
      const body = await readJson(req);
      const userId = String(body.userId || "").trim();
      if (!userId || userId.length > 200) return json(res, 400, { error: "A valid userId is required." });
      const token = signSpinToken(userId, TOKEN_SECRET);
      return json(res, 200, { url: `${PUBLIC_BASE_URL}/?t=${encodeURIComponent(token)}` });
    }

    if (req.method === "GET" && pathname === "/webhook") {
      if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === process.env.META_VERIFY_TOKEN) {
        return text(res, 200, u.searchParams.get("hub.challenge") || "");
      }
      return text(res, 403, "Forbidden");
    }

    if (req.method === "POST" && pathname === "/webhook") {
      const body = await readJson(req);
      text(res, 200, "EVENT_RECEIVED");
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const psid = event.sender?.id;
          const messageText = event.message?.text?.trim()?.toLowerCase();
          if (psid && messageText === "spin") {
            sendMessengerSpinButton(psid).catch(err => console.error("Messenger send failed:", err.message));
          }
        }
      }
      return;
    }

    if (req.method === "GET" && pathname === "/admin") {
      if (!requireAdmin(req, res)) return;
      const rows = db.prepare("SELECT * FROM spins ORDER BY id DESC LIMIT 1000").all();
      const totals = db.prepare(`SELECT COUNT(*) AS spins, SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END) AS winners, COALESCE(SUM(amount),0) AS payout, COALESCE(SUM(CASE WHEN claimed_at IS NOT NULL THEN amount ELSE 0 END),0) AS claimed FROM spins`).get();
      const bodyRows = rows.map(r => `<tr><td>${r.id}</td><td>${esc(r.user_id)}</td><td>${esc(r.prize_label)}</td><td>₱${r.amount}</td><td>${esc(r.claim_code || "-")}</td><td>${esc(r.created_at)}</td><td>${r.claimed_at ? `Claimed ${esc(r.claimed_at)}` : (r.amount > 0 ? `<form method="post" action="/admin/claim/${r.id}"><button>Mark claimed</button></form>` : "-")}</td></tr>`).join("");
      return html(res, 200, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spin Admin</title><style>body{font-family:system-ui;margin:28px;background:#f6f7fb;color:#1d2330}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:white;padding:16px;border-radius:14px;min-width:150px;box-shadow:0 4px 18px #0001}table{width:100%;border-collapse:collapse;background:white;margin-top:18px;font-size:14px}th,td{padding:10px;border-bottom:1px solid #e7e9ef;text-align:left}th{background:#fff}button{padding:7px 10px}</style></head><body><h1>Free Spin Admin</h1><div class="cards"><div class="card"><b>${totals.spins}</b><br>Spins</div><div class="card"><b>${totals.winners}</b><br>Winners</div><div class="card"><b>₱${totals.payout}</b><br>Total awarded</div><div class="card"><b>₱${totals.claimed}</b><br>Claimed</div></div><table><thead><tr><th>ID</th><th>User</th><th>Result</th><th>Amount</th><th>Claim code</th><th>Time</th><th>Status</th></tr></thead><tbody>${bodyRows}</tbody></table></body></html>`);
    }

    const claimMatch = pathname.match(/^\/admin\/claim\/(\d+)$/);
    if (req.method === "POST" && claimMatch) {
      if (!requireAdmin(req, res)) return;
      db.prepare("UPDATE spins SET claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP) WHERE id = ? AND amount > 0").run(Number(claimMatch[1]));
      res.writeHead(303, securityHeaders({ Location: "/admin" }));
      return res.end();
    }

    return text(res, 404, "Not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return json(res, 500, { error: "Internal server error" });
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Free Spin Wheel running at ${PUBLIC_BASE_URL}`);
  if (TOKEN_SECRET.includes("change-me") || ADMIN_PASSWORD === "change-me") console.warn("WARNING: replace development secrets before deploying publicly.");
});
