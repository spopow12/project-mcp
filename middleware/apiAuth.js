const User = require('../models/User');

// Middleware to authenticate API key requests
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ 
        error: 'API key required',
        message: 'Please provide an API key in the X-API-Key header or Authorization header'
      });
    }

    // Find user by API key
    const user = await User.findOne({
      'apiKey.key': apiKey,
      'apiKey.isActive': true
    });

    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid API key',
        message: 'The provided API key is invalid or has been revoked'
      });
    }

    // Check if user has Pro access
    if (!user.hasProAccess()) {
      return res.status(403).json({ 
        error: 'Pro subscription required',
        message: 'API access is only available for Pro plan subscribers'
      });
    }

    // Update API key usage
    await user.updateApiKeyUsage();

    // Attach user to request
    req.user = user;
    req.apiKeyUsed = true;

    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication error',
      message: 'Internal server error during API key authentication'
    });
  }
};

// Middleware to check Pro plan access
const requireProPlan = (req, res, next) => {
  if (!req.user || !req.user.hasProAccess()) {
    return res.status(403).json({ 
      error: 'Pro subscription required',
      message: 'This feature is only available for Pro plan subscribers'
    });
  }
  next();
};

module.exports = {
  authenticateApiKey,
  requireProPlan
};
