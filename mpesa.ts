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
export async function initiateMpesaDeposit(amount: number) {
  const accessToken = await getMpesaAccessToken();
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');

  const response = await axios.post(
    `${MPESA_API_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: '254700000000', // Replace with user phone number
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: '254700000000', // Replace with user phone number
      CallBackURL: 'https://yourdomain.com/api/mpesa/callback',
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
export async function initiateMpesaWithdrawal(amount: number) {
  const accessToken = await getMpesaAccessToken();

  const response = await axios.post(
    `${MPESA_API_URL}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName: 'apiInitiator',
      SecurityCredential: 'encryptedCredential',
      CommandID: 'BusinessPayment',
      Amount: amount,
      PartyA: MPESA_SHORTCODE,
      PartyB: '254700000000', // Replace with user phone number
      Remarks: 'Withdrawal',
      QueueTimeOutURL: 'https://yourdomain.com/api/mpesa/timeout',
      ResultURL: 'https://yourdomain.com/api/mpesa/result',
      Occasion: 'Withdrawal',
    },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  return response.data;
}
