import nodemailer, { type Transporter } from "nodemailer";

export type EmailInput = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailSender {
  send(input: EmailInput): Promise<void>;
}

export class FakeEmailSender implements EmailSender {
  readonly messages: EmailInput[] = [];

  async send(input: EmailInput): Promise<void> {
    this.messages.push({ ...input });
  }
}

class SmtpEmailSender implements EmailSender {
  constructor(private readonly transporter: Transporter) {}

  async send(input: EmailInput): Promise<void> {
    await this.transporter.sendMail(input);
  }
}

type EmailEnvironment = {
  nodeEnv: "development" | "test" | "production";
  smtpUrl?: string;
};

export function createEmailSender(config: EmailEnvironment): EmailSender {
  if (config.nodeEnv !== "production") {
    return new FakeEmailSender();
  }

  if (!config.smtpUrl) {
    throw new Error("SMTP_URL_REQUIRED");
  }

  return new SmtpEmailSender(nodemailer.createTransport(config.smtpUrl));
}
