const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid token - user not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(500).json({ message: 'Server error during authentication' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    next();
  };
};

const checkInstanceLimit = async (req, res, next) => {
  try {
    // Check if subscription is active (trial or paid)
    if (!req.user.isSubscriptionActive()) {
      return res.status(403).json({ 
        message: 'Your subscription has expired. Please upgrade to continue creating instances.',
        subscriptionStatus: req.user.subscription.status,
        trialEnded: !req.user.isTrialActive()
      });
    }

    // Check if user can create more instances
    const canCreate = await req.user.canCreateInstance();
    if (!canCreate) {
      const Instance = require('../models/Instance');
      const userInstanceCount = await Instance.countDocuments({ 
        userId: req.user._id, 
        deletedAt: null,
        status: { $nin: ['deleting', 'error'] }
      });

      const maxInstances = req.user.getMaxInstances();
      return res.status(403).json({ 
        message: `Instance limit reached. Your ${req.user.subscription.plan} plan allows ${maxInstances} instance(s).`,
        currentCount: userInstanceCount,
        maxAllowed: maxInstances,
        plan: req.user.subscription.plan,
        upgradeAvailable: req.user.subscription.plan === 'starter'
      });
    }

    next();
  } catch (error) {
    console.error('Check instance limit error:', error);
    return res.status(500).json({ message: 'Error checking instance limit' });
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  checkInstanceLimit
};
