const express = require('express');
const router = express.Router();
const { authenticateToken: auth } = require('../middleware/auth');
const Affiliate = require('../models/Affiliate');
const User = require('../models/User');
const { check, validationResult } = require('express-validator');

// @route   GET /api/affiliates/me
// @desc    Get current user's affiliate info
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    const affiliate = await Affiliate.findOne({ user: req.user.id })
      .populate('referrals.user', ['firstName', 'lastName', 'email']);
    
    if (!affiliate) {
      return res.status(404).json({ msg: 'Affiliate account not found' });
    }
    
    res.json(affiliate);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST /api/affiliates/register
// @desc    Register as an affiliate
// @access  Private
router.post(
  '/register',
  [
    auth,
    check('website', 'Website is required').optional().isURL(),
    check('paymentMethod', 'Payment method is required').isIn(['paypal', 'bank']),
    check('paypalEmail', 'PayPal email is required for PayPal payments')
      .if((value, { req }) => req.body.paymentMethod === 'paypal')
      .isEmail(),
    check('bankDetails', 'Bank details are required for bank transfer')
      .if((value, { req }) => req.body.paymentMethod === 'bank')
      .notEmpty()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { website, paymentMethod, paypalEmail, bankDetails } = req.body;

    try {
      // Check if user already has an affiliate account
      let affiliate = await Affiliate.findOne({ user: req.user.id });
      
      if (affiliate) {
        return res.status(400).json({ msg: 'Affiliate account already exists' });
      }

      // Generate unique referral code
      const generateReferralCode = () => {
        return Math.random().toString(36).substring(2, 8).toUpperCase() + 
               Math.random().toString(36).substring(2, 4).toUpperCase();
      };

      let referralCode;
      let isUnique = false;
      
      // Ensure referral code is unique
      while (!isUnique) {
        referralCode = generateReferralCode();
        const existingAffiliate = await Affiliate.findOne({ referralCode });
        if (!existingAffiliate) {
          isUnique = true;
        }
      }

      // Create new affiliate account with auto-approval
      const affiliateFields = {
        user: req.user.id,
        referralCode,
        status: 'active', // Auto-approve new affiliates
        website,
        paymentMethod,
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }
      };

      if (paymentMethod === 'paypal') {
        affiliateFields.paypalEmail = paypalEmail;
      } else if (paymentMethod === 'bank' && bankDetails) {
        affiliateFields.bankDetails = bankDetails;
      }

      affiliate = new Affiliate(affiliateFields);
      await affiliate.save();

      // Update user's role to affiliate and set affiliate status to active (auto-approval)
      const user = await User.findById(req.user.id);
      if (user.role !== 'affiliate') {
        user.role = 'affiliate';
        user.affiliateStatus = 'active'; // Auto-approve affiliate status
        await user.save();
      }

      res.json(affiliate);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  }
);

// @route   PUT /api/affiliates/payment-details
// @desc    Update payment details
// @access  Private
router.put(
  '/payment-details',
  [
    auth,
    [
      check('paymentMethod', 'Payment method is required').isIn(['paypal', 'bank']),
      check('paypalEmail', 'PayPal email is required for PayPal payments')
        .if((value, { req }) => req.body.paymentMethod === 'paypal')
        .isEmail(),
      check('bankDetails', 'Bank details are required for bank transfer')
        .if((value, { req }) => req.body.paymentMethod === 'bank')
        .isObject()
    ]
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { paymentMethod, paypalEmail, bankDetails } = req.body;

    try {
      let affiliate = await Affiliate.findOne({ user: req.user.id });
      
      if (!affiliate) {
        return res.status(404).json({ msg: 'Affiliate account not found' });
      }

      // Update payment details
      affiliate.paymentMethod = paymentMethod;
      
      if (paymentMethod === 'paypal') {
        affiliate.paypalEmail = paypalEmail;
        affiliate.bankDetails = undefined;
      } else if (paymentMethod === 'bank' && bankDetails) {
        affiliate.bankDetails = bankDetails;
        affiliate.paypalEmail = undefined;
      }

      await affiliate.save();
      res.json(affiliate);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  }
);

// @route   GET /api/affiliates/referrals
// @desc    Get all referrals
// @access  Private
router.get('/referrals', auth, async (req, res) => {
  try {
    const affiliate = await Affiliate.findOne({ user: req.user.id })
      .populate('referrals.user', ['firstName', 'lastName', 'email', 'createdAt']);
    
    if (!affiliate) {
      return res.status(404).json({ msg: 'Affiliate account not found' });
    }
    
    res.json(affiliate.referrals);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT /api/affiliates/approve/:id
// @desc    Approve affiliate application (Admin only)
// @access  Private
router.put('/approve/:id', auth, async (req, res) => {
  try {
    // For now, allow any authenticated user to approve (in production, add admin check)
    const affiliate = await Affiliate.findById(req.params.id);
    
    if (!affiliate) {
      return res.status(404).json({ msg: 'Affiliate not found' });
    }
    
    if (affiliate.status === 'active') {
      return res.status(400).json({ msg: 'Affiliate is already active' });
    }
    
    // Update affiliate status to active
    affiliate.status = 'active';
    await affiliate.save();
    
    // Update user's affiliate status
    const user = await User.findById(affiliate.user);
    if (user) {
      user.affiliateStatus = 'active';
      await user.save();
    }
    
    res.json({
      msg: 'Affiliate approved successfully',
      affiliate: {
        id: affiliate._id,
        referralCode: affiliate.referralCode,
        status: affiliate.status
      }
    });
  } catch (err) {
    console.error('Affiliate approval error:', err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   POST /api/affiliates/request-payout
// @desc    Request a payout
// @access  Private
router.post('/request-payout', auth, async (req, res) => {
  try {
    const affiliate = await Affiliate.findOne({ user: req.user.id });
    
    if (!affiliate) {
      return res.status(404).json({ msg: 'Affiliate account not found' });
    }

    const availableBalance = affiliate.totalEarnings - affiliate.paidEarnings;
    
    if (availableBalance < affiliate.settings.minimumPayout) {
      return res.status(400).json({ 
        msg: `Minimum payout amount is $${affiliate.settings.minimumPayout}` 
      });
    }

    // In a real app, this would create a payout record and process the payment
    // For now, we'll just update the affiliate record
    affiliate.paidEarnings = affiliate.totalEarnings;
    affiliate.pendingEarnings = 0;
    affiliate.lastPayoutDate = new Date();
    affiliate.nextPayoutDate = new Date(new Date().setMonth(new Date().getMonth() + 1));
    
    await affiliate.save();
    
    res.json({ 
      msg: 'Payout request submitted successfully',
      amount: availableBalance,
      nextPayoutDate: affiliate.nextPayoutDate
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET /api/affiliates/dashboard
// @desc    Get affiliate dashboard data
// @access  Private
router.get('/dashboard', auth, async (req, res) => {
  try {
    const affiliate = await Affiliate.findOne({ user: req.user.id })
      .populate({
        path: 'referrals.user',
        select: 'firstName lastName email createdAt',
        options: { sort: { createdAt: -1 }, limit: 5 }
      });
    
    if (!affiliate) {
      return res.status(404).json({ msg: 'Affiliate account not found' });
    }
    
    const dashboardData = {
      totalEarnings: affiliate.totalEarnings,
      paidEarnings: affiliate.paidEarnings,
      pendingEarnings: affiliate.pendingEarnings,
      totalReferrals: affiliate.referrals.length,
      activeReferrals: affiliate.referrals.filter(r => r.status === 'active').length,
      referralCode: affiliate.referralCode,
      referralLink: `${process.env.FRONTEND_URL || 'https://yourdomain.com'}/register?ref=${affiliate.referralCode}`,
      recentReferrals: affiliate.referrals.slice(0, 5),
      nextPayoutDate: affiliate.nextPayoutDate,
      minimumPayout: affiliate.settings.minimumPayout,
      commissionRate: affiliate.commissionRate
    };
    
    res.json(dashboardData);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET /api/affiliates/validate/:code
// @desc    Validate a referral code
// @access  Public
router.get('/validate/:code', async (req, res) => {
  try {
    const referralCode = req.params.code.toUpperCase();
    const affiliate = await Affiliate.findOne({ referralCode, status: 'active' });
    
    if (!affiliate) {
      return res.status(404).json({ valid: false, msg: 'Invalid referral code' });
    }
    
    // Get user info (without sensitive data)
    const user = await User.findById(affiliate.user).select('firstName lastName');
    
    res.json({ 
      valid: true, 
      referrer: {
        name: `${user.firstName} ${user.lastName}`,
        joinDate: affiliate.createdAt
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
