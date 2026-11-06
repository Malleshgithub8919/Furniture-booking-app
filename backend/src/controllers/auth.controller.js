import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { tokenService } from '../services/token.service.js';
import { otpService } from '../services/otp.service.js';
import { env } from '../config/env.js';

export const authController = {
  /**
   * Registers a new customer account with validated input and initial OTP generation.
   */
  async register(req, res, next) {
    try {
      const { name, email, phone, password } = req.body;

      const normalizedEmail = email ? email.trim().toLowerCase() : undefined;
      const normalizedPhone = phone ? phone.trim().replace(/^(\+91|91)/, '') : undefined;

      // Duplicate check
      const query = [];
      if (normalizedEmail) query.push({ email: normalizedEmail });
      if (normalizedPhone) query.push({ phone: normalizedPhone });

      if (query.length > 0) {
        const existing = await User.findOne({ $or: query });
        if (existing) {
          return res.status(409).json({
            success: false,
            message: 'An account with this email or mobile number already exists.'
          });
        }
      }

      // Hash password (bcrypt cost factor 12)
      const passwordHash = await bcrypt.hash(password, 12);

      // Create new customer - strictly role 'customer'
      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        role: 'customer',
        status: 'pending_verification'
      });

      // Generate initial verification OTP
      const plainOtp = otpService.generateOtp();
      const hashedOtp = otpService.hashOtp(plainOtp);
      const expiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60 * 1000);

      const channel = normalizedEmail ? 'email' : 'phone';
      const recipient = normalizedEmail || normalizedPhone;

      if (channel === 'email') {
        user.emailOtpHash = hashedOtp;
        user.emailOtpExpiresAt = expiresAt;
        user.emailOtpAttempts = 0;
      } else {
        user.phoneOtpHash = hashedOtp;
        user.phoneOtpExpiresAt = expiresAt;
        user.phoneOtpAttempts = 0;
      }
      await user.save();

      // Dispatch OTP
      const delivery = await otpService.deliverOtp({ channel, recipient, otp: plainOtp });

      // Generate Access & Refresh tokens
      const accessToken = tokenService.generateAccessToken(user);
      const { refreshToken } = await tokenService.generateRefreshToken(user);

      return res.status(201).json({
        success: true,
        message: delivery.devMode
          ? 'Account created. OTP delivery is simulated in this environment; configure an email or SMS provider to receive a code.'
          : 'Account created successfully. A verification OTP has been dispatched.',
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          status: user.status
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Authenticates user, verifies password, and issues access & refresh tokens.
   */
  async login(req, res, next) {
    try {
      const { identifier, password } = req.body;
      const cleanIdentifier = String(identifier).trim().toLowerCase();
      const cleanPhone = cleanIdentifier.replace(/^(\+91|91)/, '');

      const user = await User.findOne({
        $or: [
          { email: cleanIdentifier },
          { phone: cleanIdentifier },
          { phone: cleanPhone }
        ]
      }).select('+passwordHash');

      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Please check your email/mobile and password.'
        });
      }

      if (user.status === 'blocked') {
        return res.status(403).json({
          success: false,
          message: 'This account has been suspended. Please contact support.'
        });
      }

      const accessToken = tokenService.generateAccessToken(user);
      const { refreshToken } = await tokenService.generateRefreshToken(user);

      user.lastLoginAt = new Date();
      await user.save();

      return res.json({
        success: true,
        message: 'Login successful.',
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          status: user.status
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Refreshes access token and rotates refresh token.
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ success: false, message: 'Refresh token is required.' });
      }

      const result = await tokenService.rotateRefreshToken(refreshToken);
      if (result.error) {
        return res.status(result.status || 401).json({
          success: false,
          message: result.error
        });
      }

      return res.json({
        success: true,
        message: 'Token refreshed successfully.',
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Revokes refresh token to securely sign out.
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      if (refreshToken) {
        await tokenService.revokeRefreshToken(refreshToken);
      }
      return res.json({
        success: true,
        message: 'Signed out successfully.'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Generates and dispatches a fresh OTP for email or phone verification.
   */
  async requestOtp(req, res, next) {
    try {
      const { channel, recipient } = req.body;
      const cleanRecipient = channel === 'email'
        ? recipient.trim().toLowerCase()
        : recipient.trim().replace(/^(\+91|91)/, '');

      const user = await User.findOne(
        channel === 'email' ? { email: cleanRecipient } : { phone: cleanRecipient }
      ).select('+emailOtpHash +emailOtpExpiresAt +emailOtpAttempts +phoneOtpHash +phoneOtpExpiresAt +phoneOtpAttempts');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'No account found matching this recipient.'
        });
      }

      const plainOtp = otpService.generateOtp();
      const hashedOtp = otpService.hashOtp(plainOtp);
      const expiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60 * 1000);

      if (channel === 'email') {
        user.emailOtpHash = hashedOtp;
        user.emailOtpExpiresAt = expiresAt;
        user.emailOtpAttempts = 0;
      } else {
        user.phoneOtpHash = hashedOtp;
        user.phoneOtpExpiresAt = expiresAt;
        user.phoneOtpAttempts = 0;
      }
      await user.save();

      const delivery = await otpService.deliverOtp({ channel, recipient: cleanRecipient, otp: plainOtp });

      return res.json({
        success: true,
        message: delivery.devMode
          ? 'OTP delivery is simulated in this environment; configure an email or SMS provider to receive a code.'
          : `OTP sent successfully to ${channel}.`
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Verifies submitted OTP against stored hash.
   */
  async verifyOtp(req, res, next) {
    try {
      const { channel, recipient, otp } = req.body;
      const cleanRecipient = channel === 'email'
        ? recipient.trim().toLowerCase()
        : recipient.trim().replace(/^(\+91|91)/, '');

      const user = await User.findOne(
        channel === 'email' ? { email: cleanRecipient } : { phone: cleanRecipient }
      ).select('+emailOtpHash +emailOtpExpiresAt +emailOtpAttempts +phoneOtpHash +phoneOtpExpiresAt +phoneOtpAttempts');

      if (!user) {
        return res.status(404).json({ success: false, message: 'Account not found.' });
      }

      const isEmail = channel === 'email';
      const storedHash = isEmail ? user.emailOtpHash : user.phoneOtpHash;
      const storedExpiry = isEmail ? user.emailOtpExpiresAt : user.phoneOtpExpiresAt;
      const attempts = (isEmail ? user.emailOtpAttempts : user.phoneOtpAttempts) || 0;

      if (!storedHash || !storedExpiry) {
        return res.status(400).json({ success: false, message: 'No OTP requested for this channel.' });
      }

      // Check max attempts (brute force protection on OTP)
      if (attempts >= 5) {
        return res.status(429).json({
          success: false,
          message: 'Maximum OTP attempts exceeded. Please request a new OTP.'
        });
      }

      // Check expiration
      if (new Date() > new Date(storedExpiry)) {
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new one.'
        });
      }

      // Verify hash
      const isValid = otpService.verifyOtpHash(otp, storedHash);
      if (!isValid) {
        if (isEmail) user.emailOtpAttempts += 1;
        else user.phoneOtpAttempts += 1;
        await user.save();
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
      }

      // Success: clear OTP fields and mark verified
      if (isEmail) {
        user.emailVerified = true;
        user.emailOtpHash = undefined;
        user.emailOtpExpiresAt = undefined;
        user.emailOtpAttempts = 0;
      } else {
        user.phoneVerified = true;
        user.phoneOtpHash = undefined;
        user.phoneOtpExpiresAt = undefined;
        user.phoneOtpAttempts = 0;
      }

      if (user.status === 'pending_verification') {
        user.status = 'active';
      }

      await user.save();

      // Return refreshed token reflecting verified state
      const accessToken = tokenService.generateAccessToken(user);

      return res.json({
        success: true,
        message: `${channel === 'email' ? 'Email' : 'Mobile number'} verified successfully.`,
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          status: user.status
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Returns authenticated user profile.
   */
  async getProfile(req, res) {
    return res.json({
      success: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        role: req.user.role,
        emailVerified: req.user.emailVerified,
        phoneVerified: req.user.phoneVerified,
        status: req.user.status,
        lastLoginAt: req.user.lastLoginAt
      }
    });
  }
};
