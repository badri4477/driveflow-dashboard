import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import dotenv from 'dotenv';
import { logger } from '../middleware/errorHandler.js';
import { isPlaceholderEmail } from './placeholderEmail.js';

dotenv.config();

// Reuses the same AWS credentials already used for S3 (utils/s3Storage.js)
// — the IAM user/role just needs ses:SendEmail permission added, and the
// sending identity (SES_FROM_EMAIL, e.g. support@carzzi.com) must be a
// verified domain/address in SES for this AWS account/region, or sends
// will fail. While the account is in the SES sandbox, mail can only be
// sent to addresses that are *also* verified in SES — request production
// access to lift that.
const ses = new SESv2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'support@carzzi.com';

export const sendEmail = async (to, subject, text, html) => {
  if (!to || isPlaceholderEmail(to)) return;
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return;
  }

  const body = {};
  if (text) body.Text = { Data: text, Charset: 'UTF-8' };
  if (html) body.Html = { Data: html, Charset: 'UTF-8' };

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: body,
          },
        },
      })
    );
  } catch (error) {
    logger.error({
      message: 'SES email send failed',
      error: error.message || error,
      to,
      subject,
    });
  }
};
