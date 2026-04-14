import crypto from 'crypto';

export interface LipanaStkPushResponse {
    success: boolean;
    message: string;
    transactionId?: string;
    checkoutRequestID?: string;
}

export interface LipanaPayoutResponse {
    success: boolean;
    message: string;
    transactionId?: string;
}

export class LipanaService {
    private apiKey: string;
    private baseUrl: string = 'https://api.lipana.dev/v1';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private async request(endpoint: string, method: string, body?: any) {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || `Lipana API Error: ${response.status}`);
        }
        return data;
    }

    public async initiateStkPush(phone: string, amount: number): Promise<LipanaStkPushResponse> {
        // Ensure phone is in format 254... or +254...
        let formattedPhone = phone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.slice(1);
        } else if (!formattedPhone.startsWith('254')) {
            formattedPhone = '254' + formattedPhone;
        }

        try {
            const data = await this.request('/transactions/push-stk', 'POST', {
                phone: formattedPhone,
                amount: Math.round(amount),
            });
            return {
                success: true,
                message: data.message || 'STK Push initiated successfully',
                transactionId: data.transactionId,
                checkoutRequestID: data.checkoutRequestID,
            };
        } catch (error: any) {
            return {
                success: false,
                message: error.message,
            };
        }
    }

    public async requestPayout(phone: string, amount: number): Promise<LipanaPayoutResponse> {
        let formattedPhone = phone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.slice(1);
        } else if (!formattedPhone.startsWith('254')) {
            formattedPhone = '254' + formattedPhone;
        }

        try {
            const data = await this.request('/payouts/phone', 'POST', {
                phone: formattedPhone,
                amount: Math.round(amount),
            });
            return {
                success: true,
                message: data.message || 'Payout request successful',
                transactionId: data.transactionId,
            };
        } catch (error: any) {
            return {
                success: false,
                message: error.message,
            };
        }
    }

    public async checkTransactionStatus(transactionId: string): Promise<{ status: 'success' | 'failed' | 'pending'; mpesaReceiptNumber?: string }> {
        try {
            const data = await this.request(`/transactions/${transactionId}`, 'GET');
            const tx = data.data || data;
            const status = tx.status as string;
            if (status === 'success') {
                return { status: 'success', mpesaReceiptNumber: tx.metadata?.mpesaReceiptNumber };
            } else if (status === 'failed' || status === 'cancelled') {
                return { status: 'failed' };
            }
            return { status: 'pending' };
        } catch {
            return { status: 'pending' };
        }
    }

    public verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
        // Lipana documentation says X-Lipana-Signature is HMAC SHA256 of the body using the secret
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');
        
        return expectedSignature === signature;
    }
}
