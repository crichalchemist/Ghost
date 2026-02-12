import React from 'react';
import AppContext from '../../app-context';
import CloseButton from '../common/close-button';
import {t} from '../../utils/i18n';

export const PaymentSuccessPageStyles = `
.gh-portal-payment-success {
    text-align: center;
    padding: 24px 32px;
}

.gh-portal-payment-success h1 {
    font-size: 2.4rem;
    margin: 12px 0 8px;
}

.gh-portal-payment-success p {
    color: var(--grey3);
    font-size: 1.5rem;
    line-height: 1.5em;
    margin: 0 0 8px;
}

.gh-portal-access-token-box {
    margin: 20px 0;
    padding: 16px;
    background: var(--grey13, #f9f9f9);
    border: 1px solid var(--grey11, #e6e6e6);
    border-radius: 8px;
    text-align: left;
}

.gh-portal-access-token-box h2 {
    font-size: 1.6rem;
    margin: 0 0 8px;
    color: var(--grey1);
}

.gh-portal-access-token-url {
    display: block;
    padding: 10px 12px;
    background: var(--white);
    border: 1px solid var(--grey11, #e6e6e6);
    border-radius: 4px;
    font-family: monospace;
    font-size: 1.2rem;
    word-break: break-all;
    color: var(--grey2);
    margin: 8px 0;
    user-select: all;
}

.gh-portal-copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: var(--brandcolor);
    color: var(--white);
    border: none;
    border-radius: 4px;
    font-size: 1.4rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 8px;
    width: 100%;
    justify-content: center;
}

.gh-portal-copy-btn:hover {
    opacity: 0.9;
}

.gh-portal-warning-box {
    margin: 16px 0;
    padding: 12px;
    background: #fef3cd;
    border: 1px solid #ffc107;
    border-radius: 6px;
    text-align: left;
}

.gh-portal-warning-box p {
    color: #856404;
    font-size: 1.3rem;
    margin: 0 0 4px;
}

.gh-portal-warning-box p:last-child {
    margin-bottom: 0;
}

.gh-portal-access-btn {
    display: block;
    width: 100%;
    padding: 12px;
    background: var(--brandcolor);
    color: var(--white);
    border: none;
    border-radius: 6px;
    font-size: 1.5rem;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    text-decoration: none;
    margin-top: 16px;
}

.gh-portal-access-btn:hover {
    opacity: 0.9;
}

.gh-portal-payment-success .gh-portal-loading {
    margin: 40px 0;
}
`;

class PaymentSuccessPage extends React.Component {
    static contextType = AppContext;

    constructor(props) {
        super(props);
        this.state = {
            loading: true,
            data: null,
            error: null,
            copied: false
        };
    }

    componentDidMount() {
        this.fetchPaymentStatus();
    }

    async fetchPaymentStatus() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const invoiceId = urlParams.get('invoiceId');

            if (!invoiceId) {
                this.setState({loading: false, error: t('No invoice ID provided')});
                return;
            }

            const {site} = this.context;
            const siteUrl = site.url.replace(/\/$/, '');
            const response = await fetch(`${siteUrl}/members/payment-success?invoiceId=${encodeURIComponent(invoiceId)}`);
            const result = await response.json();

            if (result.success) {
                this.setState({loading: false, data: result});
            } else if (result.status === 'processing' || result.status === 'new') {
                // Payment still processing, poll again
                setTimeout(() => this.fetchPaymentStatus(), 3000);
            } else {
                this.setState({loading: false, error: result.message || t('Payment status unknown')});
            }
        } catch (err) {
            this.setState({loading: false, error: t('Failed to check payment status')});
        }
    }

    handleCopy(url) {
        navigator.clipboard.writeText(url).then(() => {
            this.setState({copied: true});
            setTimeout(() => this.setState({copied: false}), 2000);
        });
    }

    renderLoading() {
        return (
            <div className="gh-portal-payment-success">
                <h1>{t('Processing Payment...')}</h1>
                <p>{t('Please wait while we confirm your payment.')}</p>
                <div className="gh-portal-loading" style={{margin: '40px 0'}}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        border: '3px solid var(--grey11)',
                        borderTop: '3px solid var(--brandcolor)',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto'
                    }} />
                </div>
            </div>
        );
    }

    renderError() {
        return (
            <div className="gh-portal-payment-success">
                <h1>{t('Payment Issue')}</h1>
                <p>{this.state.error}</p>
            </div>
        );
    }

    renderAnonymousSuccess() {
        const {data, copied} = this.state;
        const accessUrl = data.accessUrl;

        return (
            <div className="gh-portal-payment-success">
                <h1>{t('Payment Successful!')}</h1>
                <p>{t('Your Bitcoin payment has been confirmed.')}</p>

                <div className="gh-portal-access-token-box">
                    <h2>{t('Save This Access Link')}</h2>
                    <p style={{fontSize: '1.3rem', color: 'var(--grey4)'}}>
                        {t('Bookmark this URL to access your subscription:')}
                    </p>
                    <code className="gh-portal-access-token-url">{accessUrl}</code>
                    <button
                        className="gh-portal-copy-btn"
                        onClick={() => this.handleCopy(accessUrl)}
                        style={{background: this.context.brandColor}}
                    >
                        {copied ? t('Copied!') : t('Copy to Clipboard')}
                    </button>
                </div>

                <div className="gh-portal-warning-box">
                    <p><strong>{t('Important:')}</strong> {t('This link cannot be recovered if lost.')}</p>
                    <p>{t('No email was provided, so we have no way to send it to you again.')}</p>
                </div>

                <a
                    href={accessUrl}
                    className="gh-portal-access-btn"
                    style={{background: this.context.brandColor}}
                >
                    {t('Access Your Content Now')}
                </a>
            </div>
        );
    }

    renderEmailSuccess() {
        const {data} = this.state;

        return (
            <div className="gh-portal-payment-success">
                <h1>{t('Payment Successful!')}</h1>
                <p>{t('Your payment has been confirmed.')}</p>
                <p>{t('A confirmation has been sent to:')} <strong>{data.email}</strong></p>
            </div>
        );
    }

    render() {
        const {loading, data, error} = this.state;

        let content;
        if (loading) {
            content = this.renderLoading();
        } else if (error) {
            content = this.renderError();
        } else if (data?.anonymous) {
            content = this.renderAnonymousSuccess();
        } else {
            content = this.renderEmailSuccess();
        }

        return (
            <>
                <CloseButton />
                <div className='gh-portal-content'>
                    {content}
                </div>
            </>
        );
    }
}

export default PaymentSuccessPage;
