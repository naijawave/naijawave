// Rate limiting (spam prevention). Server-enforced, per user or per IP.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const byIp = (windowMs, max, keyPrefix = 'ip') =>
  rateLimit({
    windowMs, max,
    keyGenerator: (req) => req.user
      ? `${keyPrefix}:u${req.user.id}`
      : `${keyPrefix}:${ipKeyGenerator(req.ip)}`,
    standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many requests — slow down a little.', code: 'RATE_LIMITED' }),
  });

module.exports = {
  authLimiter: byIp(10 * 60 * 1000, 30),
  otpVerifyLimiter: byIp(10 * 60 * 1000, 15),
  resendLimiter: byIp(60 * 60 * 1000, 10),
  postLimiter: byIp(60 * 60 * 1000, 40),
  messageLimiter: byIp(60 * 60 * 1000, 150),
  followLimiter: byIp(60 * 60 * 1000, 80),
  uploadLimiter: byIp(60 * 60 * 1000, 30),
  generalApi: byIp(60 * 1000, 300),
};
