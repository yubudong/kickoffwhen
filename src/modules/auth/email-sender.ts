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
  constructor(
    private readonly transporter: Pick<Transporter, "sendMail">,
    private readonly from: string,
  ) {}

  async send(input: EmailInput): Promise<void> {
    await this.transporter.sendMail({ ...input, from: this.from });
  }
}

type EmailEnvironment = {
  nodeEnv: "development" | "test" | "production";
  smtpUrl?: string;
  smtpFrom?: string;
};

type EmailDependencies = {
  createTransport: (url: string) => Pick<Transporter, "sendMail">;
};

export function createEmailSender(
  config: EmailEnvironment,
  dependencies: EmailDependencies = { createTransport: nodemailer.createTransport },
): EmailSender {
  if (config.nodeEnv !== "production") {
    return new FakeEmailSender();
  }

  if (!config.smtpUrl) {
    throw new Error("SMTP_URL_REQUIRED");
  }

  if (!config.smtpFrom) {
    throw new Error("SMTP_FROM_REQUIRED");
  }

  return new SmtpEmailSender(
    dependencies.createTransport(config.smtpUrl),
    config.smtpFrom,
  );
}
