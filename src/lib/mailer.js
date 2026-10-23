// Outgoing email over SMTP. Without SMTP_HOST (local dev) messages are
// printed to the console instead, so reset links still work.
import nodemailer from 'nodemailer';

let transport;
const getTransport = () => {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
};

export const sendMail = async ({ to, subject, text }) => {
  if (!process.env.SMTP_HOST) {
    console.log(`\n[mail] SMTP_HOST not set — would send to ${to}\nSubject: ${subject}\n\n${text}\n`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
};
