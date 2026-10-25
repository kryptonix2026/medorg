import { config } from "../config";

export interface BrevoEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendBrevoEmail(options: BrevoEmailOptions): Promise<void> {
  if (!config.brevoApiKey) {
    console.warn("Brevo API key not configured, skipping email");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": config.brevoApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: config.brevoFromName,
          email: config.brevoFromEmail,
        },
        to: [{ email: options.to }],
        subject: options.subject,
        textContent: options.text,
        ...(options.html && { htmlContent: options.html }),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown");
      console.error(`Brevo API error: ${response.status} - ${errorText}`);
      throw new Error(`Brevo API error: ${response.status}`);
    }
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      console.error("Brevo API timeout");
      throw new Error("Email service timeout");
    }
    throw err;
  }
}

// SMTP fallback using nodemailer
export async function sendSmtpEmail(options: BrevoEmailOptions): Promise<void> {
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: config.brevoSmtpHost,
    port: config.brevoSmtpPort,
    secure: config.brevoSmtpPort === 465,
    auth: {
      user: config.brevoSmtpUser,
      pass: config.brevoSmtpPassword,
    },
    connectionTimeout: 10000,
  });

  await transporter.sendMail({
    from: `${config.brevoFromName} <${config.brevoFromEmail}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    ...(options.html && { html: options.html }),
  });
}

export async function sendEmail(options: BrevoEmailOptions): Promise<void> {
  if (config.emailTransport === "smtp") {
    await sendSmtpEmail(options);
  } else {
    await sendBrevoEmail(options);
  }
}