const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Instance = require('../models/Instance');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get user dashboard data
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get user's instances
    const instances = await Instance.find({ 
      userId, 
      deletedAt: null 
    }).sort({ createdAt: -1 });

    // Calculate statistics
    const stats = {
      totalInstances: instances.length,
      runningInstances: instances.filter(i => i.status === 'running').length,
      deployingInstances: instances.filter(i => i.status === 'deploying').length,
      errorInstances: instances.filter(i => i.status === 'error').length,
      instancesWithDomains: instances.filter(i => i.customDomain.isActive).length,
      maxAllowed: req.user.subscription.maxInstances,
      subscriptionPlan: req.user.subscription.plan
    };

    res.json({
      user: req.user.toJSON(),
      instances,
      stats
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Server error fetching dashboard data' });
  }
});

// Get user subscription info
router.get('/subscription', authenticateToken, async (req, res) => {
  try {
    const subscription = req.user.subscription;
    const instanceCount = await Instance.countDocuments({ 
      userId: req.user._id, 
      deletedAt: null,
      status: { $nin: ['deleting', 'error'] }
    });

    res.json({
      subscription,
      usage: {
        currentInstances: instanceCount,
        maxInstances: subscription.maxInstances,
        remainingInstances: Math.max(0, subscription.maxInstances - instanceCount)
      }
    });

  } catch (error) {
    console.error('Subscription info error:', error);
    res.status(500).json({ message: 'Server error fetching subscription info' });
  }
});

// Update subscription (admin only)
router.put('/:userId/subscription', authenticateToken, requireRole(['admin']), [
  body('plan').isIn(['free', 'basic', 'premium']),
  body('maxInstances').isInt({ min: 0, max: 100 }),
  body('expiresAt').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { plan, maxInstances, expiresAt } = req.body;
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.subscription.plan = plan;
    user.subscription.maxInstances = maxInstances;
    if (expiresAt) {
      user.subscription.expiresAt = new Date(expiresAt);
    }

    await user.save();

    res.json({
      message: 'Subscription updated successfully',
      subscription: user.subscription
    });

  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ message: 'Server error updating subscription' });
  }
});

// Get all users (admin only)
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments();

    res.json({
      users,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        limit
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

// Get user by ID (admin only)
router.get('/:userId', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's instances
    const instances = await Instance.find({ 
      userId: user._id, 
      deletedAt: null 
    }).sort({ createdAt: -1 });

    res.json({
      user: user.toJSON(),
      instances,
      instanceCount: instances.length
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error fetching user' });
  }
});

// Deactivate user (admin only)
router.put('/:userId/deactivate', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isActive = false;
    await user.save();

    res.json({
      message: 'User deactivated successfully',
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ message: 'Server error deactivating user' });
  }
});

// Reactivate user (admin only)
router.put('/:userId/activate', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isActive = true;
    await user.save();

    res.json({
      message: 'User activated successfully',
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Activate user error:', error);
    res.status(500).json({ message: 'Server error activating user' });
  }
});

module.exports = router;
