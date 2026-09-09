import { Resend } from "resend";
import { newUserSignupHtml } from "./emails/newUserSignup.js";

let client: Resend | null = null;

/** Configured lazily, like storage and Textract — the server boots fine with no RESEND_API_KEY, and only fails if this is actually called. */
function resend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    client = new Resend(apiKey);
  }
  return client;
}

/**
 * Notifies the admin address that a new user just signed in.
 *
 * `onboarding@resend.dev` is Resend's own sending address for accounts that
 * haven't verified a custom domain yet — swap it once one is, for a real
 * "from" address.
 */
export async function notifyNewUser(email: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is not configured");
  }

  const timestamp = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const html = newUserSignupHtml
    .replaceAll("{{email}}", email)
    .replaceAll("{{timestamp}}", timestamp);

  // Resend resolves with { error } on an API failure rather than throwing —
  // without this check, a failed send would look identical to a successful
  // one to every caller.
  const { error } = await resend().emails.send({
    from: "Cookhouse <onboarding@resend.dev>",
    to: adminEmail,
    subject: "New Cookhouse user",
    text: `A new user just signed in: ${email}`,
    html,
  });
  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }
}
