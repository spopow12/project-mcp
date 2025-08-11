const mongoose = require('mongoose');

const instanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['deploying', 'running', 'stopped', 'error', 'deleting'],
    default: 'deploying'
  },
  instanceId: {
    type: String,
    unique: true,
    sparse: true // Allows null values but ensures uniqueness when present
  },
  url: {
    type: String,
    trim: true
  },
  customDomain: {
    domain: {
      type: String,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: false
    },
    addedAt: {
      type: Date
    },
    ssl: {
      status: {
        type: String,
        enum: ['Active', 'FAILED', 'Pending', 'Not Configured'],
        default: 'Not Configured'
      },
      isPrimary: {
        type: Boolean,
        default: false
      },
      message: {
        type: String,
        default: ''
      },
      lastChecked: {
        type: Date
      }
    }
  },
  deploymentConfig: {
    region: {
      type: String,
      default: 'us-east-1'
    },
    memory: {
      type: String,
      default: '512MB'
    },
    cpu: {
      type: String,
      default: '0.25'
    }
  },
  metadata: {
    externalId: String, // ID from the external API
    deploymentResponse: mongoose.Schema.Types.Mixed,
    lastHealthCheck: Date,
    version: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries
instanceSchema.index({ userId: 1, status: 1 });
instanceSchema.index({ instanceId: 1 });
instanceSchema.index({ 'customDomain.domain': 1 });

// Virtual for checking if instance is active
instanceSchema.virtual('isActive').get(function() {
  return this.status === 'running' && !this.deletedAt;
});

// Method to update status
instanceSchema.methods.updateStatus = function(newStatus) {
  this.status = newStatus;
  this.updatedAt = new Date();
  return this.save();
};

// Method to soft delete
instanceSchema.methods.softDelete = function() {
  this.deletedAt = new Date();
  this.status = 'deleting';
  return this.save();
};

module.exports = mongoose.model('Instance', instanceSchema);
