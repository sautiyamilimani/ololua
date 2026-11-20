import nodemailer from "nodemailer";
import type { EmailSender } from "./outbox";

export type SmtpConfiguration = {
  email: string;
  appPassword: string;
};

export class SmtpConfigurationError extends Error {}

export function getSmtpConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): SmtpConfiguration {
  const email = environment.EMAIL?.trim();
  const appPassword = environment.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

  if (!email || !appPassword) {
    throw new SmtpConfigurationError(
      "EMAIL and GMAIL_APP_PASSWORD must be configured.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new SmtpConfigurationError("EMAIL must contain a valid sender address.");
  }

  return { email, appPassword };
}

export function createGmailSmtpSender(
  configuration: SmtpConfiguration,
): EmailSender & { verify(): Promise<void>; close(): void } {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: configuration.email,
      pass: configuration.appPassword,
    },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  });

  return {
    async sendMail(message) {
      const result = await transporter.sendMail(message);
      return { messageId: result.messageId };
    },
    async verify() {
      await transporter.verify();
    },
    close() {
      transporter.close();
    },
  };
}
