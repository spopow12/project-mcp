const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/n8n-saas', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const User = require('./models/User');
const Affiliate = require('./models/Affiliate');

async function approveAffiliate() {
  try {
    console.log('🔍 Looking for affiliate with referral code: XB4CBA5Y');
    
    // Find the affiliate by referral code
    const affiliate = await Affiliate.findOne({ referralCode: 'XB4CBA5Y' });
    
    if (!affiliate) {
      console.log('❌ Affiliate not found');
      return;
    }
    
    console.log('✅ Found affiliate:', affiliate._id);
    
    // Update affiliate status to active
    affiliate.status = 'active';
    await affiliate.save();
    console.log('✅ Affiliate status updated to active');
    
    // Update user's affiliate status
    const user = await User.findById(affiliate.user);
    if (user) {
      user.affiliateStatus = 'active';
      await user.save();
      console.log('✅ User affiliate status updated to active');
      console.log('👤 User:', user.firstName, user.lastName);
    }
    
    console.log('🎉 Affiliate application approved successfully!');
    console.log('📊 Affiliate Details:');
    console.log('   - ID:', affiliate._id);
    console.log('   - Referral Code:', affiliate.referralCode);
    console.log('   - Status:', affiliate.status);
    console.log('   - Commission Rate:', affiliate.commissionRate + '%');
    
  } catch (error) {
    console.error('❌ Error approving affiliate:', error);
  } finally {
    mongoose.connection.close();
  }
}

approveAffiliate();
