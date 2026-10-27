import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { adjustCredits, db } from "./db.js";

const COOKIE = "studio_token";
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function setCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    domain: config.cookieDomain,
    maxAge: WEEK_MS,
    path: "/",
  });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare("SELECT id, email, name, credits FROM users WHERE id=?").get(payload.sub);
    if (!user) return res.status(401).json({ error: "Account not found" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Session expired" });
  }
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, credits: u.credits });

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export const authRouter = Router();

authRouter.post("/register", authLimiter, (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your name, a valid email, and a password of at least 8 characters." });
  const { name, email, password } = parsed.data;
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) return res.status(409).json({ error: "An account with this email already exists." });
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, name, password_hash, credits) VALUES (?,?,?,?,0)").run(id, email, name, bcrypt.hashSync(password, 10));
  if (config.signupCredits > 0) adjustCredits(id, config.signupCredits, "signup_bonus");
  setCookie(res, id);
  res.status(201).json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)) });
});

authRouter.post("/login", authLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email and password." });
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(parsed.data.email);
  // compare against a dummy hash when the user is unknown so timing does not reveal which emails exist
  const hash = user?.password_hash || DUMMY_HASH;
  const okPw = bcrypt.compareSync(parsed.data.password, hash);
  if (!user || !okPw) return res.status(401).json({ error: "Incorrect email or password." });
  setCookie(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/", domain: config.cookieDomain });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
