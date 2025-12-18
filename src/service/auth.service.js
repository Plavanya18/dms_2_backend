const { getdb } = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const logger = require("../config/logger");
const { sendEmail } = require("../utils/mailer");
const os = require("os");

const otpStore = new Map();

const loginUser = async (email, password) => {
  try {
    const timestamp = new Date();

    const user = await getdb.user.findUnique({
      where: { email },
      include: { details: true },
    });

    if (!user) throw new Error("Invalid credentials");

    if (!user.is_active) {
      throw new Error("Your account is deactivated. Please contact admin.");
    }

    if (user.force_logout) {
      await getdb.user.update({
        where: { id: user.id },
        data: { force_logout: false, updated_at: timestamp },
      });
      logger.info(`Force logout flag cleared for: ${email}`);
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      const attempts = (user.userDetail?.failed_login_attempts || 0) + 1;

      if (user.userDetail) {
        await getdb.userDetail.update({
          where: { user_id: user.id },
          data: {
            failed_login_attempts: attempts,
            last_failed_login: timestamp,
            reason: "Incorrect password",
            updated_at: timestamp,
          },
        });
      }

      if (attempts >= 3) {
        await getdb.user.update({
          where: { id: user.id },
          data: {
            is_active: false,
            deactivated_at: timestamp,
            deactivation_reason: "Multiple failed login attempts",
            updated_at: timestamp,
          },
        });

        throw new Error("Your account has been locked due to multiple failed login attempts.");
      }

      throw new Error(`Invalid credentials. Attempt ${attempts}/3`);
    }

    if (user.userDetail?.failed_login_attempts > 0) {
      await getdb.userDetail.update({
        where: { user_id: user.id },
        data: {
          failed_login_attempts: 0,
          last_failed_login: null,
          reason: null,
          updated_at: timestamp,
        },
      });
    }

    if (user.must_change_password) {
      return {
        status: "FORCE_PASSWORD_CHANGE",
        message: "You must change your password before logging in.",
        userId: user.id,
      };
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore.set(email, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    await sendEmail(
      email,
      "Your Login OTP",
      `Your OTP for login is ${otp}. It will expire in 5 minutes.`,
      `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
        <p>Hi <b>${user.full_name}</b>,</p>
        <p>Your OTP for login is:</p>
        <h2 style="color:#2e86de; letter-spacing: 3px;">${otp}</h2>
        <p>This code will expire in <b>5 minutes</b>.</p>
      </div>`
    );

    return {
      message: "OTP sent to your registered email address.",
      email,
    };
  } catch (error) {
    logger.error("Login failed:", error);
    throw new Error(error.message || "Login failed");
  }
};


const verifyOtp = async (email, otp, ip_id = null) => {
  try {
    const timestamp = new Date();

    const stored = otpStore.get(email);
    if (!stored || stored.otp !== otp) {
      throw new Error("Invalid or expired OTP");
    }
    otpStore.delete(email);

    const user = await getdb.user.findUnique({
      where: { email },
      include: { sessions: true },
    });

    if (!user) throw new Error("User not found");
    if (!user.is_active) throw new Error("User is deactivated");

    const activeSession = user.sessions?.find(
      (s) => s.session_status === "active"
    );

    if (activeSession) {
      await getdb.userSession.update({
        where: { id: activeSession.id },
        data: {
          session_status: "terminated",
          logout_time: timestamp,
          updated_at: timestamp,
        },
      });

      // const deletedDeals = await getdb.deal.updateMany({
      //   where: {
      //     created_by: user.id,
      //     deleted_at: null,
      //   },
      //   data: {
      //     deleted_at: timestamp,
      //   },
      // });

      await getdb.user.update({
        where: { id: user.id },
        data: { force_logout: true, updated_at: timestamp },
      });

      logger.warn(
        `User ${email} had an active session — force logout triggered.`
      );
    }

    if (user.force_logout) {
      await getdb.user.update({
        where: { id: user.id },
        data: { force_logout: false, updated_at: timestamp },
      });
      logger.info(`Force logout cleared for user: ${email}`);
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        email: user.email,
        role: user.role || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    const sessionData = {
      user_id: user.id,
      token: token,
      session_status: "active",
      login_time: timestamp,
      last_activity: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    };

    const session = await getdb.userSession.create({ data: sessionData });

    if (!session || !session.id) {
      logger.error("Session creation failed:", session);
      throw new Error("Session creation failed. Please try again.");
    }

    await getdb.user.update({
      where: { id: user.id },
      data: { last_login: timestamp, updated_at: timestamp },
    });

    logger.info(`User logged in successfully: ${user.email}`);

    return {
      message: "Login successful",
      token: sessionData.token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
      session_id: session.id,
    };
  } catch (error) {
    logger.error("OTP verification failed:", error);
    throw new Error(error.message || "OTP verification failed");
  }
};


const changePasswordByEmail = async (email, oldPassword, newPassword) => {
  try {
    const user = await getdb.user.findUnique({
      where: { email },
    });

    if (!user) {
      logger.warn(`Attempt to change password for non-existent email: ${email}`);
      return { message: "User not found" };
    }

    if (!user.must_change_password) {
      const validOldPassword = await bcrypt.compare(oldPassword, user.password);
      if (!validOldPassword) {
        logger.warn(`Incorrect old password attempt for email: ${email}`);
        return {message: "Old password is incorrect" };
      }
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      logger.warn(`New password same as old password attempt for email: ${email}`);
      return {message: "New password cannot be the same as the old password" };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await getdb.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        must_change_password: false,
        password_last_changed: new Date(),
        updated_at: new Date(),
      },
    });

    logger.info(`Password changed successfully for user: ${email}`);
    return {message: "Password changed successfully" };

  } catch (error) {
    logger.error(`Failed to change password for ${email}:`, error);
    return { message: "Internal server error while changing password" };
  }
};

const FRONTEND_URL = "http://localhost:8082/reset-password";

const sendResetPasswordEmail = async (email) => {
  const user = await getdb.user.findUnique({ where: { email } });
  if (!user) throw new Error("User not found");

  const resetLink = `${FRONTEND_URL}?email=${encodeURIComponent(email)}`;

  const subject = "Reset Your Password";
  const text = `Hello,\n\nClick the link below to reset your password:\n${resetLink}\n\nIf you did not request this, please ignore this email.`;
  const html = `
    <p>Hello,</p>
    <p>Click the link below to reset your password:</p>
    <a href="${resetLink}">Reset Password</a>
    <p>If you did not request this, please ignore this email.</p>
  `;

  await sendEmail(email, subject, text, html);
  logger.info(`Reset password email sent to ${email}`);
};

const resetPassword = async (email, newPassword) => {
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    const user = await getdb.user.update({
      where: { email: email},
      data: { password: hashed },
    });
    logger.info(`Password updated for user: ${user.email}`);
    return user;
  } catch (error) {
    logger.error("Failed to update password:", error);
    throw error;
  }
};

module.exports = { 
  loginUser,
  verifyOtp,
  changePasswordByEmail,
  sendResetPasswordEmail,
  resetPassword,
};