const express = require('express');
const { body, validationResult } = require('express-validator');
const Instance = require('../models/Instance');
const { authenticateToken, checkInstanceLimit } = require('../middleware/auth');
const ofclockApi = require('../services/ofclockApi');
const axios = require('axios');

const router = express.Router();

// Get all instances for the authenticated user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const instances = await Instance.find({ 
      userId: req.user._id, 
      deletedAt: null 
    }).sort({ createdAt: -1 });

    res.json({
      instances,
      total: instances.length
    });
  } catch (error) {
    console.error('Get instances error:', error);
    res.status(500).json({ message: 'Server error fetching instances' });
  }
});

// Get single instance by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instance not found' });
    }

    res.json({ instance });
  } catch (error) {
    console.error('Get instance error:', error);
    res.status(500).json({ message: 'Server error fetching instance' });
  }
});

// Deploy new n8n instance
router.post('/deploy', authenticateToken, checkInstanceLimit, [
  body('name').isLength({ min: 1, max: 100 }).trim().escape(),
  body('description').optional().isLength({ max: 500 }).trim().escape(),
  body('region').optional().isIn(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1']),
  body('memory').optional().isIn(['256MB', '512MB', '1GB', '2GB']),
  body('cpu').optional().isIn(['0.25', '0.5', '1', '2'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { name, description, region, memory, cpu } = req.body;

    // Check if instance name already exists for this user
    const existingInstance = await Instance.findOne({
      userId: req.user._id,
      name,
      deletedAt: null
    });

    if (existingInstance) {
      return res.status(409).json({ message: 'Instance name already exists' });
    }

    // Create instance record in database
    const instance = new Instance({
      userId: req.user._id,
      name,
      description,
      status: 'deploying',
      deploymentConfig: {
        region: region || 'us-east-1',
        memory: memory || '2GB',
        cpu: cpu || '2'
      }
    });

    await instance.save();

    // Call external API to deploy instance
    const deployResult = await ofclockApi.deployInstance(req.user._id.toString());

    if (deployResult.success) {
      // Update instance with deployment response - expecting { status: true, "unique-url": "https://example.com/new" }
      instance.metadata.deploymentResponse = deployResult.data;
      instance.url = deployResult.data['unique-url'];
      instance.status = 'running';
      
      // For temporary domains (subdomain URLs), SSL is automatically active
      if (instance.url && instance.url.startsWith('https://')) {
        // This is a temporary domain with automatic SSL
        instance.customDomain = {
          domain: null,
          isActive: false,
          ssl: {
            status: 'Active',
            isPrimary: true,
            message: 'SSL automatically enabled for temporary domain',
            lastChecked: new Date()
          }
        };
      }
      
      await instance.save();

      res.status(201).json({
        message: 'Instance deployment initiated successfully',
        instance,
        uniqueUrl: deployResult.data['unique-url']
      });
    } else {
      // Update instance status to error
      instance.status = 'error';
      instance.metadata.deploymentResponse = deployResult.error;
      await instance.save();

      res.status(deployResult.status || 500).json({
        message: 'Failed to deploy instance',
        error: deployResult.error,
        instance
      });
    }

  } catch (error) {
    console.error('Deploy instance error:', error);
    res.status(500).json({ message: 'Server error during deployment' });
  }
});

// Delete instance
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instance not found' });
    }

    // Update status to deleting
    instance.status = 'deleting';
    await instance.save();

    // Call external API to delete instance
    const deleteResult = await ofclockApi.deleteInstance(req.user._id.toString());

    if (deleteResult.success) {
      // Soft delete the instance
      await instance.softDelete();

      res.json({
        message: 'Instance deleted successfully',
        instance
      });
    } else {
      // Revert status if deletion failed
      instance.status = 'error';
      await instance.save();

      res.status(deleteResult.status || 500).json({
        message: 'Failed to delete instance',
        error: deleteResult.error,
        instance
      });
    }

  } catch (error) {
    console.error('Delete instance error:', error);
    res.status(500).json({ message: 'Server error during deletion' });
  }
});

// Add custom domain to instance
router.post('/:id/domain', authenticateToken, [
  body('domain').isLength({ min: 3, max: 255 }).matches(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { domain } = req.body;

    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instance not found' });
    }

    if (instance.status !== 'running') {
      return res.status(400).json({ message: 'Instance must be running to add a domain' });
    }

    // Check if domain is already used by another instance
    const existingDomain = await Instance.findOne({
      'customDomain.domain': domain,
      'customDomain.isActive': true,
      deletedAt: null
    });

    if (existingDomain) {
      return res.status(409).json({ message: 'Domain is already in use' });
    }

    // Call external API to add domain
    const domainResult = await ofclockApi.addDomain(req.user._id.toString(), domain);

    if (domainResult.success) {
      // Update instance with custom domain
      instance.customDomain = {
        domain,
        isActive: true,
        addedAt: new Date(),
        ssl: {
          status: 'Pending',
          isPrimary: false,
          message: 'SSL certificate is being configured',
          lastChecked: new Date()
        }
      };
      await instance.save();

      // Automatically check SSL status after domain addition
      try {
        const sslResponse = await axios.post(`${process.env.WEBHOOK_API_BASE_URL}/ssl`, {
          range: domain,
          USRID: req.user._id.toString()
        });

        // Update instance with SSL status
        instance.customDomain.ssl = {
          status: sslResponse.data.SSL_STATUS,
          isPrimary: sslResponse.data.Primary_domain,
          message: sslResponse.data.Message,
          lastChecked: new Date()
        };
        await instance.save();
      } catch (sslError) {
        console.error('Auto SSL check error:', sslError);
        // Keep the pending status if SSL check fails
        instance.customDomain.ssl.status = 'FAILED';
        instance.customDomain.ssl.message = 'Failed to verify SSL certificate';
        await instance.save();
      }

      res.json({
        message: 'Custom domain added successfully',
        instance
      });
    } else {
      res.status(domainResult.status || 500).json({
        message: 'Failed to add custom domain',
        error: domainResult.error
      });
    }

  } catch (error) {
    console.error('Add domain error:', error);
    res.status(500).json({ message: 'Server error adding domain' });
  }
});

// Remove custom domain from instance
router.delete('/:id/domain', authenticateToken, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instance not found' });
    }

    if (!instance.customDomain.isActive) {
      return res.status(400).json({ message: 'No active custom domain found' });
    }

    // Remove custom domain
    instance.customDomain.isActive = false;
    instance.customDomain.domain = null;
    await instance.save();

    res.json({
      message: 'Custom domain removed successfully',
      instance
    });

  } catch (error) {
    console.error('Remove domain error:', error);
    res.status(500).json({ message: 'Server error removing domain' });
  }
});

// Update instance configuration
router.put('/:id', authenticateToken, [
  body('name').optional().isLength({ min: 1, max: 100 }).trim().escape(),
  body('description').optional().isLength({ max: 500 }).trim().escape()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { name, description } = req.body;

    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instance not found' });
    }

    // Check if new name already exists for this user
    if (name && name !== instance.name) {
      const existingInstance = await Instance.findOne({
        userId: req.user._id,
        name,
        deletedAt: null,
        _id: { $ne: instance._id }
      });

      if (existingInstance) {
        return res.status(409).json({ message: 'Instance name already exists' });
      }
      instance.name = name;
    }

    if (description !== undefined) instance.description = description;

    await instance.save();

    res.json({
      message: 'Instance updated successfully',
      instance
    });

  } catch (error) {
    console.error('Update instance error:', error);
    res.status(500).json({ message: 'Server error updating instance' });
  }
});

// Check SSL status for instance
router.get('/:id/ssl', authenticateToken, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instance not found' });
    }

    // Only check SSL for custom domains
    if (!instance.customDomain.isActive) {
      return res.status(400).json({ message: 'SSL only available for custom domains' });
    }

    try {
      // Call external SSL API to check status
      const sslResponse = await axios.post(`${process.env.WEBHOOK_API_BASE_URL}/ssl`, {
        range: instance.customDomain.domain,
        USRID: req.user._id.toString()
      }, {
        timeout: 10000, // 10 second timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Update instance with SSL status
      instance.customDomain.ssl = {
        status: sslResponse.data.SSL_STATUS,
        isPrimary: sslResponse.data.Primary_domain,
        message: sslResponse.data.Message,
        lastChecked: new Date()
      };
      await instance.save();

      res.json({
        message: 'SSL status retrieved successfully',
        ssl: instance.customDomain.ssl
      });

    } catch (sslError) {
      console.error('SSL API error:', sslError);
      
      // Update instance with failed SSL check
      instance.customDomain.ssl = {
        status: 'FAILED',
        isPrimary: false,
        message: 'Failed to check SSL status',
        lastChecked: new Date()
      };
      await instance.save();

      res.status(500).json({ 
        message: 'Failed to check SSL status',
        ssl: instance.customDomain.ssl
      });
    }

  } catch (error) {
    console.error('Check SSL error:', error);
    res.status(500).json({ message: 'Server error checking SSL status' });
  }
});

// Manage SSL for instance (re-issue SSL certificate)
router.post('/:id/ssl', authenticateToken, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ message: 'Instance not found' });
    }

    // Only manage SSL for custom domains
    if (!instance.customDomain.isActive) {
      return res.status(400).json({ message: 'SSL only available for custom domains' });
    }

    try {
      // Call external SSL API to re-issue certificate
      const sslResponse = await axios.post(`${process.env.WEBHOOK_API_BASE_URL}/ssl`, {
        range: instance.customDomain.domain,
        USRID: req.user._id.toString()
      }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Update instance with SSL status
      instance.customDomain.ssl = {
        status: sslResponse.data.SSL_STATUS,
        isPrimary: sslResponse.data.Primary_domain,
        message: sslResponse.data.Message,
        lastChecked: new Date()
      };
      await instance.save();

      res.json({
        message: 'SSL certificate management completed',
        ssl: instance.customDomain.ssl
      });

    } catch (sslError) {
      console.error('SSL management API error:', sslError);
      
      // Update instance with failed SSL management
      instance.customDomain.ssl = {
        status: 'FAILED',
        isPrimary: false,
        message: 'Failed to manage SSL certificate',
        lastChecked: new Date()
      };
      await instance.save();

      res.status(500).json({ 
        message: 'Failed to manage SSL certificate',
        ssl: instance.customDomain.ssl
      });
    }

  } catch (error) {
    console.error('Manage SSL error:', error);
    res.status(500).json({ message: 'Server error managing SSL' });
  }
});

module.exports = router;
