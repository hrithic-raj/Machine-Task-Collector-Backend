const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');

// Helper: Send verification email
const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${process.env.APP_URL}/verify-email?token=${token}`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: {
      name: process.env.FROM_NAME || 'Machine Task Collector',
      address: process.env.FROM_EMAIL,
    },
    to: email,
    subject: 'Verify your email',
    html: `
      <h2>Welcome to Machine Task Collector!</h2>
      <p>Please verify your email by clicking the link below:</p>
      <a href="${verificationUrl}" style="
        display: inline-block;
        padding: 12px 24px;
        background-color: #007bff;
        color: white;
        text-decoration: none;
        border-radius: 4px;
        margin: 10px 0;
      ">Verify Email</a>
      <p>Or copy and paste this link in your browser:</p>
      <p>${verificationUrl}</p>
      <p>This link will expire in 24 hours.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// POST /api/auth/register - Register user with email verification
router.post('/register', async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
      });
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Create user (password will be hashed via pre-save hook)
    const user = await User.create({
      email,
      password,
      name,
      verificationToken,
      verificationExpires,
    });

    // Send verification email
    try {
      await sendVerificationEmail(user.email, verificationToken);
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Still return success, but indicate email might not have been sent
      return res.status(201).json({
        success: true,
        message:
          'User registered successfully, but verification email could not be sent. Please contact support.',
        data: user,
      });
    }

    res.status(201).json({
      success: true,
      message:
        'Registration successful! Please check your email to verify your account before logging in.',
      data: user,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// GET /api/auth/verify-email/:token - Verify email (via link click)
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    console.log('Email verification attempt with token:', token);

    // Find user with this verification token
    const user = await User.findOne({
      verificationToken: token,
      verificationExpires: { $gt: Date.now() },
    });

    if (!user) {
      console.log('Verification failed: Invalid or expired token');
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token',
      });
    }

    console.log('Found user:', user._id, 'Email:', user.email);

    // If already verified, return success (idempotent)
    if (user.isVerified) {
      console.log('User already verified, returning success');
      return res.json({
        success: true,
        message: 'Email already verified. You can now log in.',
      });
    }

    // Mark user as verified
    user.isVerified = true;
    // Don't clear verificationToken/verificationExpires to allow idempotent calls
    await user.save();

    console.log('User verified successfully:', user._id);

    // For API response (if called via frontend)
    res.json({
      success: true,
      message: 'Email verified successfully! You can now log in.',
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during email verification',
    });
  }
});

// POST /api/auth/login - Login user
router.post('/login', async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Check if user exists
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check if email is verified
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in',
      });
    }

    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Please contact support.',
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    // Set HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    });

    res.json({
      success: true,
      message: 'Logged in successfully',
      token, // Also return token in body for flexibility
      data: user,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// POST /api/auth/logout - Logout user (clear cookie)
router.post('/logout', (req, res) => {
  // Clear cookie with same options as when it was set to ensure proper deletion
  res.clearCookie('token', {
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
  });
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

// GET /api/auth/me - Get current user
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

module.exports = router;
