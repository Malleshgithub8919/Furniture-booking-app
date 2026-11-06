import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import RefreshToken from '../models/RefreshToken.js';
import User from '../models/User.js';

export const tokenService = {
  /**
   * Hashes a refresh token string for safe database lookup and storage.
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  },

  /**
   * Generates a short-lived access token (default 15m).
   */
  generateAccessToken(user) {
    return jwt.sign(
      {
        sub: user.id || user._id,
        role: user.role,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        status: user.status
      },
      env.jwtAccessSecret,
      { expiresIn: env.jwtAccessExpiresIn }
    );
  },

  /**
   * Issues a signed refresh token and stores its SHA-256 hash in MongoDB.
   * If family is not provided, a new family is started.
   */
  async generateRefreshToken(user, existingFamily = null) {
    const family = existingFamily || crypto.randomUUID();
    const tokenId = crypto.randomUUID();

    const refreshToken = jwt.sign(
      {
        sub: user.id || user._id,
        jti: tokenId,
        family
      },
      env.jwtRefreshSecret,
      { expiresIn: env.jwtRefreshExpiresIn }
    );

    // Calculate expiry date (e.g. 7 days from now)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await RefreshToken.create({
      userId: user.id || user._id,
      tokenHash: this.hashToken(refreshToken),
      family,
      isRevoked: false,
      expiresAt
    });

    return { refreshToken, family };
  },

  /**
   * Rotates a refresh token with automatic token reuse detection (RFC 6749).
   */
  async rotateRefreshToken(rawToken) {
    let payload;
    try {
      payload = jwt.verify(rawToken, env.jwtRefreshSecret);
    } catch {
      return { error: 'Invalid or expired refresh token', status: 401 };
    }

    const hashedToken = this.hashToken(rawToken);
    const existingDoc = await RefreshToken.findOne({ tokenHash: hashedToken });

    if (!existingDoc) {
      return { error: 'Refresh token not found or already consumed', status: 401 };
    }

    // Reuse detection: If an already revoked token is submitted, the entire token family is compromised!
    if (existingDoc.isRevoked) {
      await RefreshToken.updateMany({ family: existingDoc.family }, { isRevoked: true });
      return { error: 'Compromised refresh token reuse detected. All sessions revoked.', status: 403 };
    }

    // Revoke the old token (single-use policy)
    existingDoc.isRevoked = true;
    await existingDoc.save();

    // Verify user is still active
    const user = await User.findById(existingDoc.userId);
    if (!user || user.status === 'blocked') {
      return { error: 'User account is inactive or blocked', status: 403 };
    }

    // Issue new access token and rotate to a new refresh token within the same family
    const newAccessToken = this.generateAccessToken(user);
    const { refreshToken: newRefreshToken } = await this.generateRefreshToken(user, existingDoc.family);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    };
  },

  /**
   * Revokes a specific refresh token (used during logout).
   */
  async revokeRefreshToken(rawToken) {
    if (!rawToken) return false;
    const hashedToken = this.hashToken(rawToken);
    const doc = await RefreshToken.findOne({ tokenHash: hashedToken });
    if (doc) {
      doc.isRevoked = true;
      await doc.save();
      return true;
    }
    return false;
  }
};

