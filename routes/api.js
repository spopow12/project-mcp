const express = require('express');
const { body, validationResult } = require('express-validator');
const Instance = require('../models/Instance');
const User = require('../models/User');
const { authenticateApiKey, requireProPlan } = require('../middleware/apiAuth');
const ofclockApi = require('../services/ofclockApi');

const router = express.Router();

// API Documentation endpoint
router.get('/docs', (req, res) => {
  res.json({
    name: 'n8n SaaS API',
    version: '1.0.0',
    description: 'Pro API for managing n8n instances programmatically',
    authentication: 'API Key required in X-API-Key header',
    baseUrl: '/api/v1',
    endpoints: {
      instances: {
        list: 'GET /instances - List all instances',
        create: 'POST /instances - Create new instance',
        get: 'GET /instances/:id - Get instance details',
        update: 'PUT /instances/:id - Update instance settings',
        delete: 'DELETE /instances/:id - Delete instance',
        addDomain: 'POST /instances/:id/domain - Add custom domain',
        removeDomain: 'DELETE /instances/:id/domain - Remove custom domain'
      },
      user: {
        profile: 'GET /user - Get user profile and API key info'
      }
    },
    requirements: 'Pro subscription required for all endpoints'
  });
});

// Get user profile and API key information
router.get('/user', authenticateApiKey, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        subscription: user.subscription,
        apiKey: {
          hasKey: !!user.apiKey?.key,
          createdAt: user.apiKey?.createdAt,
          lastUsed: user.apiKey?.lastUsed,
          isActive: user.apiKey?.isActive
        }
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to retrieve user profile'
    });
  }
});

// List all instances
router.get('/instances', authenticateApiKey, async (req, res) => {
  try {
    const instances = await Instance.find({ 
      userId: req.user._id, 
      deletedAt: null 
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        instances: instances.map(instance => ({
          id: instance._id,
          name: instance.name,
          description: instance.description,
          status: instance.status,
          url: instance.url,
          customDomain: instance.customDomain,
          deploymentConfig: instance.deploymentConfig,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt
        })),
        total: instances.length,
        maxInstances: req.user.getMaxInstances()
      }
    });
  } catch (error) {
    console.error('API list instances error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to retrieve instances'
    });
  }
});

// Get single instance
router.get('/instances/:id', authenticateApiKey, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ 
        error: 'Instance not found',
        message: 'The specified instance does not exist or you do not have access to it'
      });
    }

    res.json({
      success: true,
      data: {
        instance: {
          id: instance._id,
          name: instance.name,
          description: instance.description,
          status: instance.status,
          url: instance.url,
          customDomain: instance.customDomain,
          deploymentConfig: instance.deploymentConfig,
          metadata: instance.metadata,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('API get instance error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to retrieve instance'
    });
  }
});

// Create new instance
router.post('/instances', authenticateApiKey, [
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
        error: 'Validation failed',
        message: 'Invalid request parameters',
        details: errors.array()
      });
    }

    // Check if user can create more instances
    const canCreate = await req.user.canCreateInstance();
    if (!canCreate) {
      const currentCount = await Instance.countDocuments({
        userId: req.user._id,
        deletedAt: null
      });
      
      return res.status(403).json({ 
        error: 'Instance limit reached',
        message: `You have reached your instance limit (${currentCount}/${req.user.getMaxInstances()}). Upgrade your plan or delete existing instances.`
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
      return res.status(409).json({ 
        error: 'Instance name exists',
        message: 'An instance with this name already exists'
      });
    }

    // Create instance record in database
    const instance = new Instance({
      userId: req.user._id,
      name,
      description,
      status: 'deploying',
      deploymentConfig: {
        region: region || 'us-east-1',
        memory: memory || '512MB',
        cpu: cpu || '0.25'
      }
    });

    await instance.save();

    // Call external API to deploy instance
    const deployResult = await ofclockApi.deployInstance(req.user._id.toString());

    if (deployResult.success) {
      // Update instance with deployment response
      instance.metadata.deploymentResponse = deployResult.data;
      instance.url = deployResult.data['unique-url'];
      instance.status = 'running';
      await instance.save();

      res.status(201).json({
        success: true,
        message: 'Instance created successfully',
        data: {
          instance: {
            id: instance._id,
            name: instance.name,
            description: instance.description,
            status: instance.status,
            url: instance.url,
            deploymentConfig: instance.deploymentConfig,
            createdAt: instance.createdAt
          }
        }
      });
    } else {
      // Update instance status to error
      instance.status = 'error';
      instance.metadata.deploymentResponse = deployResult.error;
      await instance.save();

      res.status(500).json({
        success: false,
        error: 'Deployment failed',
        message: 'Failed to deploy instance',
        details: deployResult.error
      });
    }

  } catch (error) {
    console.error('API create instance error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to create instance'
    });
  }
});

// Update instance settings
router.put('/instances/:id', authenticateApiKey, [
  body('name').optional().isLength({ min: 1, max: 100 }).trim().escape(),
  body('description').optional().isLength({ max: 500 }).trim().escape(),
  body('region').optional().isIn(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1']),
  body('memory').optional().isIn(['256MB', '512MB', '1GB', '2GB']),
  body('cpu').optional().isIn(['0.25', '0.5', '1', '2'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        message: 'Invalid request parameters',
        details: errors.array()
      });
    }

    const { name, description, region, memory, cpu } = req.body;

    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ 
        error: 'Instance not found',
        message: 'The specified instance does not exist or you do not have access to it'
      });
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
        return res.status(409).json({ 
          error: 'Instance name exists',
          message: 'An instance with this name already exists'
        });
      }
      instance.name = name;
    }

    // Update fields if provided
    if (description !== undefined) instance.description = description;
    if (region) instance.deploymentConfig.region = region;
    if (memory) instance.deploymentConfig.memory = memory;
    if (cpu) instance.deploymentConfig.cpu = cpu;

    await instance.save();

    res.json({
      success: true,
      message: 'Instance updated successfully',
      data: {
        instance: {
          id: instance._id,
          name: instance.name,
          description: instance.description,
          status: instance.status,
          url: instance.url,
          deploymentConfig: instance.deploymentConfig,
          updatedAt: instance.updatedAt
        }
      }
    });

  } catch (error) {
    console.error('API update instance error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to update instance'
    });
  }
});

// Delete instance
router.delete('/instances/:id', authenticateApiKey, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ 
        error: 'Instance not found',
        message: 'The specified instance does not exist or you do not have access to it'
      });
    }

    // Call external API to delete instance
    const deleteResult = await ofclockApi.deleteInstance(req.user._id.toString(), instance.instanceId);

    if (deleteResult.success) {
      // Soft delete the instance
      await instance.softDelete();

      res.json({
        success: true,
        message: 'Instance deleted successfully',
        data: {
          instanceId: instance._id,
          name: instance.name,
          deletedAt: instance.deletedAt
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Deletion failed',
        message: 'Failed to delete instance',
        details: deleteResult.error
      });
    }

  } catch (error) {
    console.error('API delete instance error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to delete instance'
    });
  }
});

// Add custom domain (scope) to instance
router.post('/instances/:id/domain', authenticateApiKey, [
  body('domain').isLength({ min: 3, max: 255 }).matches(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        message: 'Invalid domain format',
        details: errors.array()
      });
    }

    const { domain } = req.body;

    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ 
        error: 'Instance not found',
        message: 'The specified instance does not exist or you do not have access to it'
      });
    }

    if (instance.status !== 'running') {
      return res.status(400).json({ 
        error: 'Instance not running',
        message: 'Instance must be running to add a custom domain'
      });
    }

    // Check if domain is already used by another instance
    const existingDomain = await Instance.findOne({
      'customDomain.domain': domain,
      'customDomain.isActive': true,
      deletedAt: null
    });

    if (existingDomain) {
      return res.status(409).json({ 
        error: 'Domain in use',
        message: 'This domain is already in use by another instance'
      });
    }

    // Call external API to add domain
    const domainResult = await ofclockApi.addDomain(req.user._id.toString(), domain);

    if (domainResult.success) {
      // Update instance with custom domain
      instance.customDomain = {
        domain,
        isActive: true,
        addedAt: new Date()
      };
      await instance.save();

      res.json({
        success: true,
        message: 'Custom domain added successfully',
        data: {
          instance: {
            id: instance._id,
            name: instance.name,
            customDomain: instance.customDomain,
            updatedAt: instance.updatedAt
          }
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Domain setup failed',
        message: 'Failed to add custom domain',
        details: domainResult.error
      });
    }

  } catch (error) {
    console.error('API add domain error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to add custom domain'
    });
  }
});

// Remove custom domain from instance
router.delete('/instances/:id/domain', authenticateApiKey, async (req, res) => {
  try {
    const instance = await Instance.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null
    });

    if (!instance) {
      return res.status(404).json({ 
        error: 'Instance not found',
        message: 'The specified instance does not exist or you do not have access to it'
      });
    }

    if (!instance.customDomain?.isActive) {
      return res.status(400).json({ 
        error: 'No custom domain',
        message: 'No active custom domain found for this instance'
      });
    }

    // Remove custom domain
    instance.customDomain.isActive = false;
    instance.customDomain.domain = null;
    await instance.save();

    res.json({
      success: true,
      message: 'Custom domain removed successfully',
      data: {
        instance: {
          id: instance._id,
          name: instance.name,
          customDomain: instance.customDomain,
          updatedAt: instance.updatedAt
        }
      }
    });

  } catch (error) {
    console.error('API remove domain error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Failed to remove custom domain'
    });
  }
});

// Error handler for API routes
router.use((error, req, res, next) => {
  console.error('API route error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

module.exports = router;
