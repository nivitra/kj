const nodemailer = require('nodemailer');
const { prisma } = require('../config/prisma');
const { logger } = require('../utils/logger');

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_MINUTES || '10') * 60 * 1000;

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const sendEmailOTP = async (email, otp, studioName) => {
  await transporter.sendMail({
    from: `"${studioName}" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: `Your login code: ${otp}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1a1a2e;">${studioName}</h2>
        <p>Your one-time login code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #6c63ff; margin: 24px 0;">${otp}</div>
        <p style="color: #666; font-size: 14px;">This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
};

const sendSMSOTP = async (phone, otp, studioName) => {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    logger.warn('Twilio not configured, skipping SMS OTP');
    return;
  }
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.messages.create({
    body: `${studioName}: Your login code is ${otp}. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.`,
    from: process.env.TWILIO_PHONE,
    to: phone,
  });
};

const createAndSendOTP = async (customerId, studioName) => {
  const otp = generateOTP();
  const expiry = new Date(Date.now() + OTP_EXPIRY);

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: { otpCode: otp, otpExpiry: expiry },
  });

  const isProd = process.env.NODE_ENV === 'production';
  try {
    if (customer.email) await sendEmailOTP(customer.email, otp, studioName);
    else if (customer.phone) await sendSMSOTP(customer.phone, otp, studioName);
  } catch (err) {
    // In production a delivery failure is fatal; locally we fall back to the log.
    if (isProd) throw err;
    logger.warn(`OTP delivery failed (${err.message}); using dev console fallback.`);
  }

  // Dev convenience: surface the code so you can test login without SMTP/SMS set up.
  if (!isProd) {
    logger.info(`🔑 DEV OTP for ${customer.email || customer.phone}: ${otp}`);
  }

  return { sent: true };
};

const verifyOTP = async (customerId, inputOTP) => {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer?.otpCode || !customer?.otpExpiry) return false;
  if (new Date() > customer.otpExpiry) return false;
  if (customer.otpCode !== inputOTP) return false;

  await prisma.customer.update({
    where: { id: customerId },
    data: { otpCode: null, otpExpiry: null, lastLoginAt: new Date() },
  });
  return true;
};

module.exports = { createAndSendOTP, verifyOTP };
