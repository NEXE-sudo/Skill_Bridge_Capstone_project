import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export type EmailMessage = { to: string; subject: string; text: string };

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;

  constructor(private readonly from: string, url: string) {
    this.transporter = nodemailer.createTransport(url);
  }

  async send(message: EmailMessage) {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    console.info("Development email preview", message);
  }
}

class MemoryEmailProvider implements EmailProvider {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.messages.push(message);
  }
}

function createEmailProvider(env: NodeJS.ProcessEnv): EmailProvider {
  const smtpUrl = env.SMTP_URL;
  const from = env.EMAIL_FROM;
  if (smtpUrl && from) return new SmtpEmailProvider(from, smtpUrl);
  if (smtpUrl || from) throw new Error("SMTP_URL and EMAIL_FROM must be configured together");
  if (env.NODE_ENV === "production") throw new Error("SMTP_URL and EMAIL_FROM are required in production");
  return env.NODE_ENV === "test" ? new MemoryEmailProvider() : new ConsoleEmailProvider();
}

let provider: EmailProvider | undefined;

function getEmailProvider() {
  provider ??= createEmailProvider(process.env);
  return provider;
}

export const emailProvider: EmailProvider = {
  send: (message) => getEmailProvider().send(message),
};

export function capturedTestEmails() {
  return provider instanceof MemoryEmailProvider ? [...provider.messages] : [];
}
