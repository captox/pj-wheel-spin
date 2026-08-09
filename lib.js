const crypto = require("crypto");
const { prizes, tokenValiditySeconds } = require("./config");

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signSpinToken(userId, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = {
    sub: String(userId),
    iat: nowSeconds,
    exp: nowSeconds + tokenValiditySeconds,
    nonce: crypto.randomBytes(12).toString("hex")
  };
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySpinToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw new Error("Invalid token");
  }
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig || "", "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid token signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || !payload.exp || payload.exp < now) {
    throw new Error("Expired token");
  }
  return payload;
}

function choosePrize() {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0);
  const roll = crypto.randomInt(total);
  let cursor = 0;
  for (const prize of prizes) {
    cursor += prize.weight;
    if (roll < cursor) return prize;
  }
  throw new Error("Prize selection failed");
}

function makeClaimCode() {
  return `SPIN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function publicOdds() {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0);
  return prizes.map(p => ({
    id: p.id,
    shortLabel: p.shortLabel,
    label: p.label,
    amount: p.amount,
    probability: p.weight / total,
    percent: (p.weight / total) * 100
  }));
}

module.exports = { signSpinToken, verifySpinToken, choosePrize, makeClaimCode, publicOdds };
