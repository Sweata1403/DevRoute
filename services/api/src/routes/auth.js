const express = require('express');
const jwt = require('jsonwebtoken');
const { isEmail } = require('validator');
const { createUser, findByEmail, verifyPassword } = require('../models/user');

const router = express.Router();

/**
 * POST /api/auth/register
 * Create a new account. Returns a JWT on success.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !isEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await createUser(email.toLowerCase(), password);

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      user: { id: user.id, email: user.email },
      token
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Authenticate and receive a JWT.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await findByEmail(email.toLowerCase());

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      // Same error message for both cases - prevents user enumeration
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      user: { id: user.id, email: user.email },
      token
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;