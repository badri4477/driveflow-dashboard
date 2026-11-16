/**
 * Customers an admin creates without an email get a placeholder address,
 * because the User schema requires one. It must never be shown or emailed.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'customer.carzzi.in';

export const placeholderEmailFor = (phone) => `c${phone}@${PLACEHOLDER_EMAIL_DOMAIN}`;

export const isPlaceholderEmail = (email) =>
  typeof email === 'string' && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);

/** Email safe to show or send to: '' for placeholders. */
export const publicEmail = (email) => (isPlaceholderEmail(email) ? '' : email || '');
