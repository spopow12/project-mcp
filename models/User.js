const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  isActive: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'affiliate'],
    default: 'user'
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  referralCode: {
    type: String,
    trim: true,
    uppercase: true,
    sparse: true
  },
  affiliateStatus: {
    type: String,
    enum: ['not_affiliate', 'pending', 'active', 'suspended'],
    default: 'not_affiliate'
  },
  referralStats: {
    totalReferrals: {
      type: Number,
      default: 0
    },
    activeReferrals: {
      type: Number,
      default: 0
    },
    totalEarnings: {
      type: Number,
      default: 0
    },
    paidEarnings: {
      type: Number,
      default: 0
    },
    pendingEarnings: {
      type: Number,
      default: 0
    }
  },
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'starter', 'pro'], // Keep 'free' for backward compatibility
      default: 'starter'
    },
    status: {
      type: String,
      enum: ['trial', 'active', 'expired', 'cancelled'],
      default: 'trial'
    },
    maxInstances: {
      type: Number,
      default: 1
    },
    price: {
      type: Number,
      default: 3.99
    },
    trialStartedAt: {
      type: Date,
      default: Date.now
    },
    trialEndsAt: {
      type: Date,
      default: function() {
        return new Date(Date.now() + 60 * 60 * 1000); // 60 minutes from now
      }
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly'
    },
    nextBillingDate: {
      type: Date,
      default: null
    },
    stripeCustomerId: {
      type: String,
      default: null
    },
    stripeSubscriptionId: {
      type: String,
      default: null
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: null
  },
  apiKey: {
    key: {
      type: String,
      unique: true,
      sparse: true // Allows null values but ensures uniqueness when present
    },
    createdAt: {
      type: Date,
      default: null
    },
    lastUsed: {
      type: Date,
      default: null
    },
    isActive: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Subscription utility methods
userSchema.methods.isTrialActive = function() {
  return this.subscription.status === 'trial' && new Date() < this.subscription.trialEndsAt;
};

userSchema.methods.isSubscriptionActive = function() {
  return this.subscription.status === 'active' || this.isTrialActive();
};

userSchema.methods.getMaxInstances = function() {
  if (!this.isSubscriptionActive()) return 0;
  
  // Use the database maxInstances value if set, otherwise use plan defaults
  if (this.subscription.maxInstances !== undefined && this.subscription.maxInstances !== null) {
    return this.subscription.maxInstances;
  }
  
  // Fallback to plan defaults for backward compatibility
  const planLimits = {
    free: 1, // Backward compatibility
    starter: 1,
    pro: -1 // Unlimited instances for pro plan
  };
  
  return planLimits[this.subscription.plan] || 0;
};

userSchema.methods.canCreateInstance = async function() {
  if (!this.isSubscriptionActive()) return false;
  
  const maxInstances = this.getMaxInstances();
  
  // If unlimited instances (-1), always allow creation
  if (maxInstances === -1) return true;
  
  const Instance = require('./Instance');
  const instanceCount = await Instance.countDocuments({
    userId: this._id,
    deletedAt: null
  });
  
  return instanceCount < maxInstances;
};

userSchema.methods.upgradeToPro = function() {
  this.subscription.plan = 'pro';
  this.subscription.maxInstances = -1; // Unlimited instances
  this.subscription.price = 19.99;
  return this.save();
};

userSchema.methods.startPaidSubscription = function() {
  this.subscription.status = 'active';
  this.subscription.nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  return this.save();
};

// Affiliate methods
userSchema.methods.hasAffiliateAccess = function() {
  return this.affiliateStatus === 'active';
};

// Generate a random referral code if one doesn't exist
userSchema.methods.generateReferralCode = function() {
  if (!this.referralCode) {
    // Generate a random 6-character alphanumeric code
    this.referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  return this.referralCode;
};

// Apply a referral code
userSchema.methods.applyReferral = async function(referralCode) {
  if (this.referredBy || this.affiliateStatus === 'active') {
    throw new Error('Referral already applied or user is an affiliate');
  }
  
  const referrer = await this.constructor.findOne({ 
    referralCode: referralCode.toUpperCase(),
    affiliateStatus: 'active'
  });
  
  if (!referrer) {
    throw new Error('Invalid referral code');
  }
  
  this.referredBy = referrer._id;
  return referrer;
};

// Update referral stats when a new user signs up
userSchema.methods.updateReferralStats = async function() {
  if (!this.referredBy) return;
  
  const referrer = await this.constructor.findById(this.referredBy);
  if (referrer && referrer.affiliateStatus === 'active') {
    referrer.referralStats.totalReferrals += 1;
    // Referral becomes active when the user subscribes (handled in subscription logic)
    await referrer.save();
  }
};

// API Key management methods
userSchema.methods.generateApiKey = function() {
  const crypto = require('crypto');
  const apiKey = 'n8n_' + crypto.randomBytes(32).toString('hex');
  
  this.apiKey = {
    key: apiKey,
    createdAt: new Date(),
    lastUsed: null,
    isActive: true
  };
  
  return this.save().then(() => apiKey);
};

userSchema.methods.revokeApiKey = function() {
  this.apiKey = {
    key: null,
    createdAt: null,
    lastUsed: null,
    isActive: false
  };
  return this.save();
};

userSchema.methods.updateApiKeyUsage = function() {
  if (this.apiKey && this.apiKey.isActive) {
    this.apiKey.lastUsed = new Date();
    return this.save();
  }
};

userSchema.methods.hasProAccess = function() {
  return this.subscription.plan === 'pro' && this.isSubscriptionActive();
};

// Remove sensitive data from JSON output
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.__v;
  
  // Don't expose internal IDs and sensitive data
  if (user.affiliateStatus !== 'active') {
    delete user.referralStats;
    delete user.referralCode;
  }
  
  return user;
};

module.exports = mongoose.model('User', userSchema);
