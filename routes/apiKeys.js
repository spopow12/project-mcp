const express = require('express');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get API key information
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Check if user has Pro access
    if (!user.hasProAccess()) {
      return res.status(403).json({ 
        message: 'Pro subscription required',
        details: 'API key access is only available for Pro plan subscribers'
      });
    }

    res.json({
      hasApiKey: !!user.apiKey?.key,
      isActive: user.apiKey?.isActive || false,
      createdAt: user.apiKey?.createdAt,
      lastUsed: user.apiKey?.lastUsed,
      keyPreview: user.apiKey?.key ? `${user.apiKey.key.substring(0, 12)}...` : null
    });
  } catch (error) {
    console.error('Get API key info error:', error);
    res.status(500).json({ message: 'Server error fetching API key information' });
  }
});

// Generate new API key
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Check if user has Pro access
    if (!user.hasProAccess()) {
      return res.status(403).json({ 
        message: 'Pro subscription required',
        details: 'API key generation is only available for Pro plan subscribers'
      });
    }

    // Generate new API key
    const apiKey = await user.generateApiKey();

    res.json({
      message: 'API key generated successfully',
      apiKey: apiKey,
      warning: 'Store this key securely. You will not be able to see it again.',
      createdAt: user.apiKey.createdAt
    });
  } catch (error) {
    console.error('Generate API key error:', error);
    res.status(500).json({ message: 'Server error generating API key' });
  }
});

// Revoke API key
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user.apiKey?.isActive) {
      return res.status(400).json({ 
        message: 'No active API key found'
      });
    }

    // Revoke API key
    await user.revokeApiKey();

    res.json({
      message: 'API key revoked successfully'
    });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ message: 'Server error revoking API key' });
  }
});

// Regenerate API key (revoke old and create new)
router.post('/regenerate', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Check if user has Pro access
    if (!user.hasProAccess()) {
      return res.status(403).json({ 
        message: 'Pro subscription required',
        details: 'API key regeneration is only available for Pro plan subscribers'
      });
    }

    // Generate new API key (this will replace the old one)
    const apiKey = await user.generateApiKey();

    res.json({
      message: 'API key regenerated successfully',
      apiKey: apiKey,
      warning: 'Store this key securely. You will not be able to see it again. Your old API key has been revoked.',
      createdAt: user.apiKey.createdAt
    });
  } catch (error) {
    console.error('Regenerate API key error:', error);
    res.status(500).json({ message: 'Server error regenerating API key' });
  }
});

module.exports = router;
