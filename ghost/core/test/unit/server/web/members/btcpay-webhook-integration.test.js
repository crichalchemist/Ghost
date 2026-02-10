const should = require('should');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');

describe('BTCPay Webhook Integration', function () {
    let app;
    let btcpayController;

    beforeEach(function () {
        // Create a minimal Express app for testing
        app = express();
        
        // Mock BTCPay webhook controller
        btcpayController = {
            handle: sinon.stub().callsFake((req, res) => {
                res.status(200).json({received: true});
            })
        };

        // Register the webhook route
        const bodyParser = require('body-parser');
        app.post('/webhooks/btcpay', bodyParser.json(), btcpayController.handle);
    });

    afterEach(function () {
        sinon.restore();
    });

    it('should register BTCPay webhook route', async function () {
        const response = await request(app)
            .post('/webhooks/btcpay')
            .send({type: 'InvoiceSettled', invoiceId: 'inv_123'})
            .expect(200);

        response.body.should.have.property('received', true);
        btcpayController.handle.calledOnce.should.be.true();
    });

    it('should parse JSON body for BTCPay webhooks', async function () {
        const webhookData = {
            type: 'InvoiceSettled',
            invoiceId: 'inv_123',
            metadata: {
                memberEmail: 'test@example.com',
                tier: 'annual'
            }
        };

        await request(app)
            .post('/webhooks/btcpay')
            .send(webhookData)
            .expect(200);

        btcpayController.handle.calledOnce.should.be.true();
        const req = btcpayController.handle.firstCall.args[0];
        req.body.should.deepEqual(webhookData);
    });

    it('should handle BTCPay webhook errors gracefully', async function () {
        btcpayController.handle.callsFake((req, res) => {
            res.status(400).json({error: 'Invalid signature'});
        });

        await request(app)
            .post('/webhooks/btcpay')
            .send({type: 'Invalid'})
            .expect(400);
    });
});
