const User = require('../models/User');
const Instance = require('../models/Instance');
const ofclockApi = require('./ofclockApi');

class TrialService {
  constructor() {
    this.checkInterval = 3600000; // Check every hour (60 * 60 * 1000 ms)
    this.intervalId = null;
  }

  start() {
    console.log('🕐 Trial service started - checking for expired trials every hour');
    this.intervalId = setInterval(() => {
      this.checkExpiredTrials();
    }, this.checkInterval);
    
    // Run initial check
    this.checkExpiredTrials();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 Trial service stopped');
    }
  }

  async checkExpiredTrials() {
    try {
      const now = new Date();
      
      // Find users with expired trials that haven't been processed
      const expiredTrialUsers = await User.find({
        'subscription.status': 'trial',
        'subscription.trialEndsAt': { $lt: now }
      });

      console.log(`🔍 Found ${expiredTrialUsers.length} expired trials to process`);

      for (const user of expiredTrialUsers) {
        await this.handleExpiredTrial(user);
      }
    } catch (error) {
      console.error('❌ Error checking expired trials:', error);
    }
  }

  async handleExpiredTrial(user) {
    try {
      console.log(`⏰ Processing expired trial for user: ${user._id} (${user.email})`);

      // Find user's instances
      const userInstances = await Instance.find({
        userId: user._id,
        deletedAt: null,
        status: { $nin: ['deleting', 'error'] }
      });

      // Disable each instance via API
      for (const instance of userInstances) {
        console.log(`🔒 Disabling instance ${instance._id} for user ${user._id}`);
        
        const disableResult = await ofclockApi.disableInstance(user._id.toString());
        
        if (disableResult.success) {
          // Update instance status to disabled
          instance.status = 'disabled';
          instance.metadata.disabledAt = new Date();
          instance.metadata.disabledReason = 'Trial expired';
          await instance.save();
          
          console.log(`✅ Instance ${instance._id} disabled successfully`);
        } else {
          console.error(`❌ Failed to disable instance ${instance._id}:`, disableResult.error);
        }
      }

      // Update user subscription status
      user.subscription.status = 'expired';
      user.subscription.expiredAt = new Date();
      await user.save();

      console.log(`✅ Trial expiration processed for user ${user._id}`);
    } catch (error) {
      console.error(`❌ Error handling expired trial for user ${user._id}:`, error);
    }
  }

  async enableUserInstances(userId) {
    try {
      console.log(`🔓 Enabling instances for user: ${userId}`);

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Find user's disabled instances
      const disabledInstances = await Instance.find({
        userId: userId,
        deletedAt: null,
        status: 'disabled'
      });

      // Enable each instance via API
      for (const instance of disabledInstances) {
        console.log(`🔓 Enabling instance ${instance._id} for user ${userId}`);
        
        const enableResult = await ofclockApi.enableInstance(userId.toString());
        
        if (enableResult.success) {
          // Update instance status to running
          instance.status = 'running';
          instance.metadata.enabledAt = new Date();
          instance.metadata.enabledReason = 'Payment received';
          await instance.save();
          
          console.log(`✅ Instance ${instance._id} enabled successfully`);
        } else {
          console.error(`❌ Failed to enable instance ${instance._id}:`, enableResult.error);
        }
      }

      return {
        success: true,
        enabledInstances: disabledInstances.length
      };
    } catch (error) {
      console.error(`❌ Error enabling instances for user ${userId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new TrialService();
