import axios from 'axios';

const MPESA_API_URL = 'https://api.safaricom.co.ke';
const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || '';
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || '';
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || '';
const MPESA_PASSKEY = process.env.MPESA_PASSKEY || '';

// Generate Mpesa Access Token
async function getMpesaAccessToken() {
  const response = await axios.get(`${MPESA_API_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    auth: {
      username: MPESA_CONSUMER_KEY,
      password: MPESA_CONSUMER_SECRET,
    },
  });
  return response.data.access_token;
}

// Initiate Mpesa Deposit
export async function initiateMpesaDeposit(amount: number, phone: string, callbackUrl: string): Promise<any>;
export async function initiateMpesaDeposit(amount: number): Promise<any>;
export async function initiateMpesaDeposit(amount: number, phone?: string, callbackUrl?: string) {
  const accessToken = await getMpesaAccessToken();
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
  
  if (!phone) {
    throw new Error('Phone number is required for Mpesa deposit.');
  }
  if (!callbackUrl) {
    throw new Error('Callback URL is required for Mpesa deposit.');
  }

  // Format phone number
  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) formattedPhone = `254${formattedPhone.slice(1)}`;

  const response = await axios.post(
    `${MPESA_API_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone, // Replace with user phone number
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: formattedPhone, // Replace with user phone number
      CallBackURL: callbackUrl,
      AccountReference: 'BettingSite',
      TransactionDesc: 'Deposit',
    },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return response.data;
}

// Initiate Mpesa Withdrawal
export async function initiateMpesaWithdrawal(amount: number, phone: string, resultUrl: string, timeoutUrl: string): Promise<any>;
export async function initiateMpesaWithdrawal(amount: number): Promise<any>;
export async function initiateMpesaWithdrawal(amount: number, phone?: string, resultUrl?: string, timeoutUrl?: string) {
  const accessToken = await getMpesaAccessToken();
  
  if (!phone) {
    throw new Error('Phone number is required for Mpesa withdrawal.');
  }
  if (!resultUrl) {
    throw new Error('Result URL is required for Mpesa withdrawal.');
  }
  if (!timeoutUrl) {
    throw new Error('Timeout URL is required for Mpesa withdrawal.');
  }

  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) formattedPhone = `254${formattedPhone.slice(1)}`;

  const response = await axios.post(
    `${MPESA_API_URL}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName: process.env.MPESA_INITIATOR || 'apiInitiator',
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL || 'encryptedCredential',
      CommandID: 'BusinessPayment',
      Amount: Math.round(amount),
      PartyA: MPESA_SHORTCODE,
      PartyB: formattedPhone, // Replace with user phone number
      Remarks: 'Withdrawal',
      QueueTimeOutURL: timeoutUrl,
      ResultURL: resultUrl,
      Occasion: 'Withdrawal',
    },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return response.data;
}
