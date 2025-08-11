const mongoose = require('mongoose');

const AffiliateSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  referralCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended'],
    default: 'pending'
  },
  website: {
    type: String,
    trim: true
  },
  paymentMethod: {
    type: String,
    enum: ['paypal', 'bank'],
    required: true
  },
  paypalEmail: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true
  },
  bankDetails: {
    accountNumber: String,
    accountName: String,
    bankName: String,
    swiftCode: String,
    iban: String
  },
  commissionRate: {
    type: Number,
    default: 20, // 20% commission
    min: 0,
    max: 100
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
  },
  referrals: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    date: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'cancelled'],
      default: 'pending'
    },
    lifetimeValue: {
      type: Number,
      default: 0
    },
    commissionEarned: {
      type: Number,
      default: 0
    }
  }],
  settings: {
    autoWithdraw: {
      type: Boolean,
      default: false
    },
    minimumPayout: {
      type: Number,
      default: 50
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      newReferral: {
        type: Boolean,
        default: true
      },
      payout: {
        type: Boolean,
        default: true
      }
    }
  },
  lastPayoutDate: Date,
  nextPayoutDate: Date,
  metadata: {
    ipAddress: String,
    userAgent: String,
    signupDate: {
      type: Date,
      default: Date.now
    },
    lastActive: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Generate a unique referral code before saving
AffiliateSchema.pre('save', async function(next) {
  if (!this.referralCode) {
    let isUnique = false;
    let code;
    
    while (!isUnique) {
      // Generate a random 8-character alphanumeric code
      code = Math.random().toString(36).substring(2, 6).toUpperCase() + 
             Math.random().toString(36).substring(2, 6).toUpperCase();
      
      // Check if code already exists
      const existing = await mongoose.model('Affiliate').findOne({ referralCode: code });
      if (!existing) {
        isUnique = true;
      }
    }
    
    this.referralCode = code;
  }
  
  next();
});

// Virtual for total number of active referrals
AffiliateSchema.virtual('totalReferrals').get(function() {
  return this.referrals.filter(ref => ref.status === 'active').length;
});

// Virtual for available balance (totalEarnings - paidEarnings)
AffiliateSchema.virtual('availableBalance').get(function() {
  return this.totalEarnings - this.paidEarnings;
});

// Static method to calculate commission
AffiliateSchema.statics.calculateCommission = function(amount, commissionRate = 20) {
  return (amount * commissionRate) / 100;
};

// Method to add a new referral
AffiliateSchema.methods.addReferral = async function(userId, amount = 0) {
  const referral = {
    user: userId,
    lifetimeValue: amount,
    commissionEarned: this.constructor.calculateCommission(amount, this.commissionRate),
    status: 'active'
  };
  
  this.referrals.push(referral);
  this.totalEarnings += referral.commissionEarned;
  this.pendingEarnings += referral.commissionEarned;
  
  await this.save();
  return referral;
};

// Method to process a payout
AffiliateSchema.methods.processPayout = async function(amount) {
  if (amount > this.availableBalance) {
    throw new Error('Insufficient balance for payout');
  }
  
  this.paidEarnings += amount;
  this.pendingEarnings -= amount;
  this.lastPayoutDate = new Date();
  this.nextPayoutDate = new Date(new Date().setMonth(new Date().getMonth() + 1));
  
  await this.save();
  return this;
};

const Affiliate = mongoose.model('Affiliate', AffiliateSchema);

module.exports = Affiliate;
