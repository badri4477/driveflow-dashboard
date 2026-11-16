import axios from 'axios';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { isOtpExternalDeliveryEnabled, isTestingEnv } from './appEnvironment.js';

const MSG91_OTP_URL = 'https://control.msg91.com/api/v5/otp';
const MSG91_VERIFY_URL = 'https://control.msg91.com/api/v5/otp/verify';
const MSG91_LEGACY_SENDOTP_URL = 'http://api.msg91.com/api/sendotp.php';
const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow';
const MSG91_WHATSAPP_URL =
  'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

const OTP_LENGTH = 6;

const normalizeIndianMobile = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  return null;
};

const useWhatsAppOutbound = () => {
  const templateName = process.env.MSG91_WHATSAPP_TEMPLATE_NAME?.trim();
  const integratedNumber = process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim();
  return Boolean(templateName && integratedNumber);
};

const smsFallbackEnabled = () => {
  const flag = process.env.MSG91_SIGNUP_SMS_FALLBACK;
  return flag === undefined || flag === '' || flag === 'true' || flag === '1';
};

const resolveMsg91TemplateId = () => {
  const templateId =
    process.env.MSG91_Auth_Template_ID?.trim() ||
    process.env.MSG91_OTP_TEMPLATE_ID?.trim() ||
    process.env.MSG91_OTP_FLOW_ID?.trim() ||
    '';

  if (!templateId) {
    throw new Error(
      'MSG91_OTP_TEMPLATE_ID is not set. In MSG91 Dashboard go to OTP → Templates and copy the Template ID (long alphanumeric string, not the template name).'
    );
  }

  if (templateId.toLowerCase() === 'otp' || templateId.length < 12) {
    throw new Error(
      `MSG91_OTP_TEMPLATE_ID "${templateId}" is not valid. Use the Template ID from MSG91 (OTP → Templates), not the template name. Or configure WhatsApp: MSG91_WHATSAPP_TEMPLATE_NAME, MSG91_WHATSAPP_INTEGRATED_NUMBER in backend/.env`
    );
  }

  return templateId;
};

const generateOtp = () => {
  const otp = String(crypto.randomInt(100000, 999999));
  return { otp, otpHash: bcrypt.hashSync(otp, 10) };
};

const maskMobileForLog = (mobile) => {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (digits.length < 4) return digits || 'unknown';
  return `******${digits.slice(-4)}`;
};

/** Local debugging — never enable LOG_OTP_TO_CONSOLE in production (testing always logs). */
const logOtpToConsole = (mobile, otp, label = 'auth') => {
  const allow =
    isTestingEnv() ||
    process.env.NODE_ENV !== 'production' ||
    process.env.LOG_OTP_TO_CONSOLE === 'true';
  if (!allow || !otp) return;
  console.log(
    `[OTP ${label}] mobile=${maskMobileForLog(mobile)} code=${otp} (valid 10 min)`
  );
};

/** MSG91 auth template sample: body_1 + button_1 (copy code) both need the OTP value. */
const buildAuthTemplateComponents = (otp) => ({
  body_1: {
    type: 'text',
    value: otp,
  },
  button_1: {
    subtype: 'url',
    type: 'text',
    value: otp,
  },
});

const resolveWhatsAppTemplateName = (override) => {
  return (
    override?.trim() ||
    process.env.MSG91_WHATSAPP_AUTH_TEMPLATE_NAME?.trim() ||
    process.env.MSG91_WHATSAPP_TEMPLATE_NAME?.trim() ||
    'user_authentication'
  );
};

const resolveAssignedWhatsAppTemplateName = () => {
  return (
    process.env.MSG91_WHATSAPP_ASSIGNED_TEMPLATE_NAME?.trim() ||
    'general_service'
  );
};

const resolveFeedbackWhatsAppTemplateName = () => {
  return (
    process.env.MSG91_WHATSAPP_FEEDBACK_TEMPLATE_NAME?.trim() ||
    'feedback'
  );
};

const sendWhatsAppMessage = async (mobile, templateName, components) => {
  if (!isOtpExternalDeliveryEnabled()) {
    console.info(
      `[WhatsApp testing] APP_ENV=testing — skipped WhatsApp outbound message (${templateName}) for ${maskMobileForLog(mobile)}`,
      { components }
    );
    return { delivery: 'testing', status: 'skipped', message: 'Skipped in testing environment' };
  }

  const authkey = process.env.MSG91_AUTH_KEY;
  const integratedNumber = process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim();
  const namespace = process.env.MSG91_WHATSAPP_NAMESPACE?.trim();
  const languageCode = process.env.MSG91_WHATSAPP_LANGUAGE || 'en';

  if (!authkey) {
    throw new Error('MSG91_AUTH_KEY is not configured');
  }
  if (!integratedNumber) {
    throw new Error(
      'MSG91_WHATSAPP_INTEGRATED_NUMBER is required for WhatsApp messages (your MSG91 WhatsApp business number).'
    );
  }

  const templatePayload = {
    name: templateName,
    language: {
      code: languageCode,
      policy: 'deterministic',
    },
    to_and_components: [
      {
        to: [mobile],
        components: components || {},
      },
    ],
  };

  if (namespace) {
    templatePayload.namespace = namespace;
  }

  const payload = {
    integrated_number: integratedNumber,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: templatePayload,
    },
  };

  const response = await axios.post(MSG91_WHATSAPP_URL, payload, {
    headers: {
      authkey,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });

  const data = response.data;
  if (data?.type === 'error' || data?.hasError || data?.status === 'fail') {
    throw new Error(
      data?.message || data?.errors || JSON.stringify(data) || 'Failed to send WhatsApp message'
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[MSG91 WhatsApp] queued', {
      mobile: `******${mobile.slice(-4)}`,
      request_id: data?.request_id,
      status: data?.status,
    });
  }

  return data;
};

const sendWhatsAppOtp = async (mobile, otp, templateOverride) => {
  if (!isOtpExternalDeliveryEnabled()) {
    console.info(
      `[WhatsApp OTP testing] APP_ENV=testing — skipped WhatsApp OTP for ${maskMobileForLog(mobile)}`
    );
    return { delivery: 'testing', status: 'skipped', message: 'Skipped in testing environment' };
  }

  const authkey = process.env.MSG91_AUTH_KEY;
  const integratedNumber = process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER?.trim();
  const templateName = resolveWhatsAppTemplateName(templateOverride);
  const namespace = process.env.MSG91_WHATSAPP_NAMESPACE?.trim();
  const languageCode = process.env.MSG91_WHATSAPP_LANGUAGE || 'en';

  if (!authkey) {
    throw new Error('MSG91_AUTH_KEY is not configured');
  }
  if (!integratedNumber) {
    throw new Error(
      'MSG91_WHATSAPP_INTEGRATED_NUMBER is required for WhatsApp OTP (your MSG91 WhatsApp business number).'
    );
  }

  const templatePayload = {
    name: templateName,
    language: {
      code: languageCode,
      policy: 'deterministic',
    },
    to_and_components: [
      {
        to: [mobile],
        components: buildAuthTemplateComponents(otp),
      },
    ],
  };

  if (namespace) {
    templatePayload.namespace = namespace;
  }

  const payload = {
    integrated_number: integratedNumber,
    content_type: 'template',
    payload: {
      messaging_product: 'whatsapp',
      type: 'template',
      template: templatePayload,
    },
  };

  const response = await axios.post(MSG91_WHATSAPP_URL, payload, {
    headers: {
      authkey,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });

  const data = response.data;
  if (data?.type === 'error' || data?.hasError || data?.status === 'fail') {
    throw new Error(
      data?.message || data?.errors || JSON.stringify(data) || 'Failed to send WhatsApp OTP'
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[MSG91 WhatsApp] queued', {
      mobile: `******${mobile.slice(-4)}`,
      request_id: data?.request_id,
      status: data?.status,
    });
  }

  return data;
};

/** Same OTP via SMS using modern MSG91 OTP API with template. */
const sendSmsOtpFallback = async (mobile, otp) => {
  const authkey = process.env.MSG91_AUTH_KEY;
  const templateId = resolveMsg91TemplateId();
  const flowId = process.env.MSG91_OTP_FLOW_ID?.trim();
  if (!authkey) return;

  const params = {
    mobile,
    otp,
    otp_length: OTP_LENGTH,
    otp_expiry: 10,
  };

  if (flowId && flowId !== templateId) {
    params.flow_id = flowId;
  } else {
    params.template_id = templateId;
  }

  const response = await axios.post(MSG91_OTP_URL, {}, {
    params,
    headers: {
      authkey,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  const data = response.data;
  if (data?.type === 'error') {
    console.warn('[MSG91 SMS fallback] failed:', data?.message);
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.info('[MSG91 SMS fallback] sent', { mobile: `******${mobile.slice(-4)}` });
  }
};

const sendMsg91Otp = async (mobile) => {
  const authkey = process.env.MSG91_AUTH_KEY;
  const templateId = resolveMsg91TemplateId();
  const flowId = process.env.MSG91_OTP_FLOW_ID?.trim();

  const params = {
    mobile,
    otp_length: OTP_LENGTH,
  };

  if (flowId && flowId !== templateId) {
    params.flow_id = flowId;
  } else {
    params.template_id = templateId;
  }

  const response = await axios.post(MSG91_OTP_URL, {}, {
    params,
    headers: {
      authkey,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  const data = response.data;
  if (data?.type === 'error') {
    throw new Error(data?.message || 'Failed to send OTP');
  }

  return data;
};

const sendAuthOtp = async (mobile, templateName) => {
  if (!isOtpExternalDeliveryEnabled()) {
    const { otp, otpHash } = generateOtp();
    logOtpToConsole(mobile, otp, templateName || 'testing');
    console.info(
      `[OTP testing] APP_ENV=testing — skipped WhatsApp/SMS for ${maskMobileForLog(mobile)}`
    );
    return { delivery: 'testing', otpHash, channels: [] };
  }

  if (useWhatsAppOutbound()) {
    const { otp, otpHash } = generateOtp();
    logOtpToConsole(mobile, otp, templateName || 'user_authentication');
    const channels = [];
    const errors = [];

    const whatsappPromise = sendWhatsAppOtp(mobile, otp, templateName)
      .then(() => {
        channels.push('whatsapp');
      })
      .catch((whatsappError) => {
        console.error('[MSG91 WhatsApp] send failed:', whatsappError.message);
        errors.push(whatsappError);
      });

    const smsPromise = smsFallbackEnabled() 
      ? sendSmsOtpFallback(mobile, otp)
          .then(() => {
            channels.push('sms');
          })
          .catch((smsError) => {
            console.error('[MSG91 SMS] error:', smsError.message);
            errors.push(smsError);
          })
      : Promise.resolve();

    await Promise.all([whatsappPromise, smsPromise]);

    if (channels.length === 0) {
      throw new Error('Failed to send OTP via WhatsApp and SMS. Please try again.');
    }

    return { delivery: 'whatsapp', otpHash, channels };
  }

  console.log(
    `[OTP msg91-api] mobile=${maskMobileForLog(mobile)} — OTP generated by MSG91 (not logged locally)`
  );
  await sendMsg91Otp(mobile);
  return { delivery: 'msg91' };
};

const sendSignupOtp = async (mobile) => {
  return sendAuthOtp(mobile);
};

const verifySignupOtp = async (mobile, otp, pending) => {
  if (pending?.otpHash) {
    const valid = await bcrypt.compare(String(otp).trim(), pending.otpHash);
    if (!valid) {
      throw new Error('Invalid or expired OTP');
    }
    return { delivery: 'whatsapp' };
  }

  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) {
    throw new Error('MSG91_AUTH_KEY is not configured');
  }

  const response = await axios.get(MSG91_VERIFY_URL, {
    params: {
      mobile,
      otp: String(otp).trim(),
    },
    headers: {
      authkey,
    },
    timeout: 15000,
  });

  const data = response.data;
  if (data?.type !== 'success') {
    throw new Error(data?.message || 'Invalid or expired OTP');
  }

  return { delivery: 'msg91' };
};

/** Transactional SMS through an MSG91 Flow (DLT-approved template). `vars` map to the template's ##var## names. */
const sendFlowSms = async (mobile, templateId, vars = {}) => {
  if (!isOtpExternalDeliveryEnabled()) {
    console.info(`[SMS testing] APP_ENV=testing — skipped SMS (${templateId}) for ${maskMobileForLog(mobile)}`, vars);
    return { status: 'skipped' };
  }
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) throw new Error('MSG91_AUTH_KEY is not configured');
  const response = await axios.post(
    MSG91_FLOW_URL,
    { template_id: templateId, short_url: '1', recipients: [{ mobiles: mobile, ...vars }] },
    { headers: { authkey, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  if (response.data?.type === 'error') {
    throw new Error(response.data?.message || 'Failed to send SMS');
  }
  return response.data;
};

export {
  sendFlowSms,
  normalizeIndianMobile,
  sendAuthOtp,
  sendSignupOtp,
  verifySignupOtp,
  sendWhatsAppMessage,
  resolveAssignedWhatsAppTemplateName,
  resolveFeedbackWhatsAppTemplateName,
};
