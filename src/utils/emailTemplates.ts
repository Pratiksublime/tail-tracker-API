import { transporter } from "../lib/mailer";

/**
 * Sends a Password Reset OTP email
 */
export const sendOtpEmail = async (to: string, otp: string, name: string) => {
    const html = `
    <div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px;">
      <h2>Tail Tracker Security</h2>
      <p>Hello ${name},</p>
      <p>Your verification code is:</p>
      <h1 style="color: #4F46E5; letter-spacing: 5px;">${otp}</h1>
      <p>This code expires in 5 minutes.</p>
    </div>
  `;

    return await transporter.sendMail({
        from: `"Tail Tracker" <${process.env.MAIL_USER}>`,
        to,
        subject: "Your Verification Code",
        html,
    });
};

/**
 * Example: Send Welcome Email
 */
export const sendWelcomeEmail = async (to: string, name: string) => {
    const html = `<h1>Welcome to the pack, ${name}!</h1>`;

    return await transporter.sendMail({
        from: `"Tail Tracker" <${process.env.MAIL_USER}>`,
        to,
        subject: "Welcome to Tail Tracker",
        html,
    });
};