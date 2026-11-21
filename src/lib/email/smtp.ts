import { lookup } from "node:dns/promises";
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

export async function createGmailSmtpSender(
  configuration: SmtpConfiguration,
): Promise<EmailSender & { verify(): Promise<void>; close(): void }> {
  const addresses = await lookup("smtp.gmail.com", { all: true });
  const server = addresses.find((address) => address.family === 4) ?? addresses[0];

  if (!server) {
    throw new Error("Gmail SMTP host did not resolve to an IP address.");
  }

  const transporter = nodemailer.createTransport({
    host: server.address,
    port: 465,
    secure: true,
    tls: { servername: "smtp.gmail.com" },
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
