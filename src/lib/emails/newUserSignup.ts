/** The "cookhouse" wordmark row at the top of the card. */
const emailHeader = `<tr>
            <td style="padding:28px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:22px; height:22px; background-color:#4A6B47; border-radius:6px; text-align:center; vertical-align:middle; font-family:Georgia, 'Times New Roman', serif; font-weight:bold; font-size:12px; color:#ffffff;">C</td>
                  <td style="padding-left:8px; font-family:Georgia, 'Times New Roman', serif; font-weight:bold; font-size:15px; color:#2B2318;">cookhouse</td>
                </tr>
              </table>
            </td>
          </tr>`;

/** The actual content — substitute `{{email}}` and `{{timestamp}}` before sending. */
const emailBody = `<tr>
            <td style="padding:4px 32px 20px 32px;">
              <h1 style="margin:0; font-size:20px; line-height:1.3; color:#2B2318; font-weight:bold;">New user signed up</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0 0 16px 0; font-size:14px; line-height:1.6; color:#3f3a30;">Someone just created an account.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f6f4ee; border-radius:6px;">
                <tr>
                  <td style="padding:14px 16px 10px 16px;">
                    <p style="margin:0 0 4px 0; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#7d7057;">Email</p>
                    <p style="margin:0; font-size:15px; color:#2B2318; font-weight:bold;">{{email}}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 16px 14px 16px;">
                    <p style="margin:0 0 4px 0; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#7d7057;">Signed up</p>
                    <p style="margin:0; font-size:14px; color:#2B2318;">{{timestamp}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

/** The "Automated notification" disclaimer row at the bottom of the card. */
const emailFooter = `<tr>
            <td style="padding:16px 32px 28px 32px; border-top:1px solid #eee9dd;">
              <p style="margin:0; font-size:12px; line-height:1.5; color:#9a9182;">Automated notification from Cookhouse.</p>
            </td>
          </tr>`;

/** Designed template for `notifyNewUser` — substitute `{{email}}` and `{{timestamp}}` before sending. */
export const newUserSignupHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>New Cookhouse signup</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f1ec; font-family:Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f1ec; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px; max-width:90%; background-color:#ffffff; border:1px solid #e2ded3; border-radius:8px;">
          ${emailHeader}
          ${emailBody}
          ${emailFooter}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
