const axios = require('axios');

class WebhookApiService {
  constructor() {
    this.baseURL = process.env.WEBHOOK_API_BASE_URL;
    this.authUser = process.env.WEBHOOK_AUTH_USER || 'webhook';
    this.authPass = process.env.WEBHOOK_AUTH_PASS || 'webhook123';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json'
      },
      auth: {
        username: this.authUser,
        password: this.authPass
      },
      timeout: 30000, // 30 seconds timeout
      // DNS resolution options
      family: 4, // Force IPv4
      lookup: require('dns').lookup
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`🚀 API Request: ${config.method.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`✅ API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error('❌ API Response Error:', error.response?.status, error.response?.data);
        return Promise.reject(error);
      }
    );
  }

  async deployInstance(userId) {
    try {
      console.log(`🔍 Attempting to deploy instance for userId: ${userId}`);
      console.log(`🌐 Using base URL: ${this.baseURL}`);
      
      const response = await this.client.post('/deploy', { userId });
      console.log(`✅ Deploy successful:`, response.data);
      
      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      console.error('❌ Deploy instance error details:');
      console.error('- Error code:', error.code);
      console.error('- Error message:', error.message);
      console.error('- Response status:', error.response?.status);
      console.error('- Response data:', error.response?.data);
      console.error('- Full error:', error);
      
      return {
        success: false,
        error: error.response?.data || { 
          message: error.message,
          code: error.code,
          details: 'DNS resolution or network connectivity issue'
        },
        status: error.response?.status || 500
      };
    }
  }

  async deleteInstance(userId) {
    try {
      const response = await this.client.post('/delete', { userId });
      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      console.error('Delete instance error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || { message: error.message },
        status: error.response?.status || 500
      };
    }
  }

  async addDomain(userId, domain) {
    try {
      const response = await this.client.post('/domain', { userId, domain });
      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      console.error('Add domain error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || { message: error.message },
        status: error.response?.status || 500
      };
    }
  }

  async disableInstance(userId) {
    try {
      console.log(`🔍 Attempting to disable instance for userId: ${userId}`);
      const response = await this.client.post('/disable', { userId });
      console.log(`✅ Disable successful:`, response.data);
      
      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      console.error('❌ Disable instance error details:');
      console.error('- Error code:', error.code);
      console.error('- Error message:', error.message);
      console.error('- Response status:', error.response?.status);
      console.error('- Response data:', error.response?.data);
      
      return {
        success: false,
        error: error.response?.data || { 
          message: error.message,
          code: error.code,
          details: 'Failed to disable instance'
        },
        status: error.response?.status || 500
      };
    }
  }

  async enableInstance(userId) {
    try {
      console.log(`🔍 Attempting to enable instance for userId: ${userId}`);
      const response = await this.client.post('/enable', { userId });
      console.log(`✅ Enable successful:`, response.data);
      
      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      console.error('❌ Enable instance error details:');
      console.error('- Error code:', error.code);
      console.error('- Error message:', error.message);
      console.error('- Response status:', error.response?.status);
      console.error('- Response data:', error.response?.data);
      
      return {
        success: false,
        error: error.response?.data || { 
          message: error.message,
          code: error.code,
          details: 'Failed to enable instance'
        },
        status: error.response?.status || 500
      };
    }
  }

  // Helper method to check API health
  async healthCheck() {
    try {
      const response = await this.client.get('/health');
      return {
        success: true,
        data: response.data,
        status: response.status
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data || { message: error.message },
        status: error.response?.status || 500
      };
    }
  }
}

module.exports = new WebhookApiService();
