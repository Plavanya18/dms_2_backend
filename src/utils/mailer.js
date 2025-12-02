const nodemailer = require("nodemailer");
const config = require("../config/config");
const logger = require("../config/logger");

const transporter = nodemailer.createTransport({
  host: config.email.smtp.host,
  port: config.email.smtp.port,
  auth: {
    user: config.email.smtp.auth.user,
    pass: config.email.smtp.auth.pass,
  },
});

/**
 * Send email using configured SMTP transporter
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string} [html]
 */
const sendEmail = async (to, subject, text, html = null) => {
  try {
    const mailOptions = {
      from: config.email.from || `"System" <${config.email.smtp.auth.user}>`,
      to,
      subject,
      text,
      html,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`📧 Email sent successfully to ${to}`);
  } catch (error) {
    logger.error(`❌ Failed to send email to ${to}:`, error);
    throw new Error("Failed to send email");
  }
};

module.exports = { sendEmail };
