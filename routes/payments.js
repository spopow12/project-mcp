const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const trialService = require('../services/trialService');

const router = express.Router();

// PayPal configuration
const PAYPAL_CONFIG = {
  email: 'username.chaimae@gmail.com',
  currency: 'USD',
  plans: {
    starter: {
      price: 3.99,
      name: 'Starter Plan'
    },
    pro: {
      price: 9.99,
      name: 'Pro Plan'
    }
  }
};

// Create PayPal payment URL
router.post('/create-paypal-payment', authenticateToken, [
  body('plan').isIn(['starter', 'pro']).withMessage('Invalid plan selected')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { plan } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const planConfig = PAYPAL_CONFIG.plans[plan];
    const returnUrl = `${req.protocol}://${req.get('host')}/api/payments/paypal-success`;
    const cancelUrl = `${req.protocol}://${req.get('host')}/api/payments/paypal-cancel`;

    // Create PayPal payment URL
    const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?` +
      `cmd=_xclick&` +
      `business=${encodeURIComponent(PAYPAL_CONFIG.email)}&` +
      `item_name=${encodeURIComponent(planConfig.name)}&` +
      `amount=${planConfig.price}&` +
      `currency_code=${PAYPAL_CONFIG.currency}&` +
      `custom=${user._id}&` +
      `return=${encodeURIComponent(returnUrl)}&` +
      `cancel_return=${encodeURIComponent(cancelUrl)}&` +
      `notify_url=${encodeURIComponent(`${req.protocol}://${req.get('host')}/api/payments/paypal-ipn`)}&` +
      `no_shipping=1&` +
      `no_note=1`;

    res.json({
      paypalUrl,
      plan: planConfig.name,
      amount: planConfig.price,
      message: 'PayPal payment URL created successfully'
    });

  } catch (error) {
    console.error('Create PayPal payment error:', error);
    res.status(500).json({ message: 'Server error creating PayPal payment' });
  }
});

// PayPal success callback
router.get('/paypal-success', async (req, res) => {
  try {
    const { custom: userId, tx: transactionId, amt: amount, st: status } = req.query;

    if (status === 'Completed' && userId && transactionId) {
      await processSuccessfulPayment(userId, transactionId, amount);
      
      // Redirect to frontend success page
      res.redirect(`http://localhost:3000/payment-success?tx=${transactionId}`);
    } else {
      res.redirect(`http://localhost:3000/payment-error?reason=incomplete`);
    }
  } catch (error) {
    console.error('PayPal success callback error:', error);
    res.redirect(`http://localhost:3000/payment-error?reason=server_error`);
  }
});

// PayPal cancel callback
router.get('/paypal-cancel', (req, res) => {
  res.redirect(`http://localhost:3000/payment-cancelled`);
});

// PayPal IPN (Instant Payment Notification) handler
router.post('/paypal-ipn', express.raw({ type: 'application/x-www-form-urlencoded' }), async (req, res) => {
  try {
    // In a production environment, you should verify the IPN with PayPal
    // For now, we'll process the payment based on the success callback
    
    const params = new URLSearchParams(req.body.toString());
    const paymentStatus = params.get('payment_status');
    const userId = params.get('custom');
    const transactionId = params.get('txn_id');
    const amount = params.get('mc_gross');

    if (paymentStatus === 'Completed' && userId && transactionId) {
      await processSuccessfulPayment(userId, transactionId, amount);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('PayPal IPN error:', error);
    res.status(500).send('Error');
  }
});

// Process successful payment
async function processSuccessfulPayment(userId, transactionId, amount) {
  try {
    console.log(`💳 Processing successful payment for user ${userId}, transaction: ${transactionId}, amount: ${amount}`);

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Determine plan based on amount
    let plan = 'starter';
    if (parseFloat(amount) >= 9.99) {
      plan = 'pro';
    }

    // Update user subscription
    user.subscription.plan = plan;
    user.subscription.status = 'active';
    user.subscription.price = parseFloat(amount);
    user.subscription.nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    user.subscription.maxInstances = plan === 'pro' ? 5 : 1;
    
    // Add payment record
    if (!user.subscription.payments) {
      user.subscription.payments = [];
    }
    user.subscription.payments.push({
      transactionId,
      amount: parseFloat(amount),
      date: new Date(),
      status: 'completed',
      method: 'paypal'
    });

    await user.save();

    // Enable user's instances
    const enableResult = await trialService.enableUserInstances(userId);
    
    console.log(`✅ Payment processed successfully for user ${userId}. Enabled ${enableResult.enabledInstances} instances.`);

    return {
      success: true,
      plan,
      enabledInstances: enableResult.enabledInstances
    };

  } catch (error) {
    console.error(`❌ Error processing payment for user ${userId}:`, error);
    throw error;
  }
}

// Manual payment processing (for testing)
router.post('/process-payment', authenticateToken, [
  body('plan').isIn(['starter', 'pro']).withMessage('Invalid plan selected'),
  body('transactionId').notEmpty().withMessage('Transaction ID required'),
  body('amount').isFloat({ min: 0 }).withMessage('Valid amount required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { plan, transactionId, amount } = req.body;
    
    const result = await processSuccessfulPayment(req.user._id, transactionId, amount);
    
    res.json({
      message: 'Payment processed successfully',
      plan: result.plan,
      enabledInstances: result.enabledInstances
    });

  } catch (error) {
    console.error('Manual payment processing error:', error);
    res.status(500).json({ message: 'Server error processing payment' });
  }
});

module.exports = router;
