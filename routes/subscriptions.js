const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const User = require('../models/User');
const Affiliate = require('../models/Affiliate');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Pricing plans configuration
const PRICING_PLANS = {
  starter: {
    name: 'Starter',
    price: 3.99,
    maxInstances: 1,
    features: ['1 n8n Instance', '60-minute Free Trial', 'Basic Support'],
    trialDuration: 60 * 60 * 1000 // 60 minutes in milliseconds
  },
  pro: {
    name: 'Pro',
    price: 19.99,
    maxInstances: -1, // -1 represents unlimited
    features: ['Unlimited n8n Instances', 'Priority Support', 'Advanced Features'],
    trialDuration: 0 // No trial for pro plan
  }
};

// Get all pricing plans
router.get('/plans', (req, res) => {
  res.json({
    plans: PRICING_PLANS,
    message: 'Available pricing plans'
  });
});

// Get current user's subscription status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const subscriptionStatus = {
      plan: user.subscription.plan,
      status: user.subscription.status,
      price: user.subscription.price,
      maxInstances: user.getMaxInstances(),
      isTrialActive: user.isTrialActive(),
      isSubscriptionActive: user.isSubscriptionActive(),
      trialEndsAt: user.subscription.trialEndsAt,
      nextBillingDate: user.subscription.nextBillingDate,
      planDetails: PRICING_PLANS[user.subscription.plan]
    };

    res.json({
      subscription: subscriptionStatus,
      message: 'Subscription status retrieved successfully'
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ message: 'Server error fetching subscription status' });
  }
});

// Start trial (for new users or plan changes)
// Process affiliate commission for a subscription payment
async function processAffiliateCommission(user, amount, transactionId) {
  if (!user.referredBy) return null;
  
  try {
    const referrer = await User.findById(user.referredBy);
    if (!referrer || !referrer.hasAffiliateAccess()) return null;
    
    // Get or create affiliate record
    let affiliate = await Affiliate.findOne({ user: referrer._id });
    if (!affiliate) {
      affiliate = new Affiliate({
        user: referrer._id,
        status: 'active',
        paymentMethod: 'paypal',
        paypalEmail: referrer.email
      });
      await affiliate.save();
    }
    
    // Calculate commission (20% of the payment)
    const commission = (amount * 20) / 100;
    
    // Update affiliate stats
    affiliate.totalEarnings += commission;
    affiliate.pendingEarnings += commission;
    
    // Add to referrals if not already there
    const existingReferral = affiliate.referrals.find(
      ref => ref.user.toString() === user._id.toString()
    );
    
    if (existingReferral) {
      existingReferral.lifetimeValue += amount;
      existingReferral.commissionEarned += commission;
      existingReferral.lastPaymentDate = new Date();
      existingReferral.status = 'active';
    } else {
      affiliate.referrals.push({
        user: user._id,
        lifetimeValue: amount,
        commissionEarned: commission,
        status: 'active',
        firstPaymentDate: new Date(),
        lastPaymentDate: new Date(),
        transactionId
      });
      
      // Update user's referral stats
      referrer.referralStats.activeReferrals += 1;
      await referrer.save();
    }
    
    await affiliate.save();
    
    return {
      affiliateId: affiliate._id,
      referrerId: referrer._id,
      commission,
      transactionId
    };
  } catch (error) {
    console.error('Error processing affiliate commission:', error);
    return null;
  }
}

router.post('/start-trial', authenticateToken, [
  body('plan').isIn(['starter', 'pro']).withMessage('Invalid plan selected'),
  body('referralCode').optional().isString().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }
    
    const { plan, referralCode } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Handle referral code if provided
    if (referralCode) {
      try {
        await user.applyReferral(referralCode);
        await user.save();
      } catch (err) {
        // Don't fail the request if referral code is invalid, just log it
        console.log('Error applying referral code:', err.message);
      }
    }

    // Check if user already has an active subscription
    if (user.isSubscriptionActive() && user.subscription.plan === plan) {
      return res.status(400).json({ 
        message: `You already have an active ${plan} subscription` 
      });
    }

    const planConfig = PRICING_PLANS[plan];
    
    // Update user subscription
    user.subscription.plan = plan;
    user.subscription.status = 'trial';
    user.subscription.price = planConfig.price;
    user.subscription.maxInstances = planConfig.maxInstances;
    user.subscription.trialStartedAt = new Date();
    user.subscription.trialEndsAt = new Date(Date.now() + planConfig.trialDuration);
    
    await user.save();

    res.json({
      message: `${planConfig.name} trial started successfully`,
      subscription: {
        plan: user.subscription.plan,
        status: user.subscription.status,
        trialEndsAt: user.subscription.trialEndsAt,
        maxInstances: user.getMaxInstances()
      }
    });
  } catch (error) {
    console.error('Start trial error:', error);
    res.status(500).json({ message: 'Server error starting trial' });
  }
});

// Upgrade to Pro plan
router.post('/upgrade-to-pro', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.subscription.plan === 'pro') {
      return res.status(400).json({ message: 'You are already on the Pro plan' });
    }

    await user.upgradeToPro();

    res.json({
      message: 'Successfully upgraded to Pro plan',
      subscription: {
        plan: user.subscription.plan,
        status: user.subscription.status,
        price: user.subscription.price,
        maxInstances: user.getMaxInstances()
      }
    });
  } catch (error) {
    console.error('Upgrade to Pro error:', error);
    res.status(500).json({ message: 'Server error upgrading to Pro plan' });
  }
});

// Convert trial to paid subscription

router.post('/convert-to-paid', authenticateToken, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const user = await User.findById(req.user._id).session(session);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.subscription.status !== 'trial') {
      return res.status(400).json({ message: 'No active trial to convert' });
    }

    await user.startPaidSubscription();

    // Update subscription status to active
    user.subscription.status = 'active';
    user.subscription.nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    
    // Process affiliate commission if applicable
    let commissionResult = null;
    if (user.referredBy) {
      commissionResult = await processAffiliateCommission(
        user,
        user.subscription.price,
        `sub_${user._id}_${Date.now()}`
      );
    }
    
    await user.save({ session });
    await session.commitTransaction();
    
    res.status(200).json({
      message: 'Subscription successfully converted to paid',
      subscription: user.subscription,
      commission: commissionResult ? {
        processed: true,
        amount: commissionResult.commission,
        currency: 'USD'
      } : { processed: false }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Convert to paid error:', error);
    res.status(500).json({ 
      message: 'Error converting to paid subscription',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
});

// Process subscription payment (webhook from payment processor)
router.post('/webhook/payment', express.json(), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { userId, amount, transactionId } = req.body;
    
    // Validate required fields
    if (!userId || !amount || !transactionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const user = await User.findById(userId).session(session);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update subscription dates
    user.subscription.lastPaymentDate = new Date();
    user.subscription.nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    
    // Process affiliate commission if applicable
    let commissionResult = null;
    if (user.referredBy) {
      commissionResult = await processAffiliateCommission(
        user,
        amount,
        transactionId
      );
    }
    
    await user.save({ session });
    await session.commitTransaction();
    
    res.status(200).json({
      success: true,
      userId,
      amount,
      commissionProcessed: !!commissionResult,
      commissionAmount: commissionResult ? commissionResult.commission : 0
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Payment webhook error:', error);
    res.status(500).json({ 
      error: 'Error processing payment',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
});

// Check if user can create instances (used by instance creation)
router.get('/can-create-instance', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const canCreate = await user.canCreateInstance();
    const maxInstances = user.getMaxInstances();
    
    // Get current instance count
    const Instance = require('../models/Instance');
    const currentInstances = await Instance.countDocuments({
      userId: user._id,
      deletedAt: null
    });

    res.json({
      canCreate,
      currentInstances,
      maxInstances,
      plan: user.subscription.plan,
      status: user.subscription.status,
      isTrialActive: user.isTrialActive(),
      trialEndsAt: user.subscription.trialEndsAt
    });
  } catch (error) {
    console.error('Can create instance check error:', error);
    res.status(500).json({ message: 'Server error checking instance creation permission' });
  }
});

module.exports = router;
