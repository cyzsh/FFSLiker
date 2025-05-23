const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 11000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

app.set('trust proxy', 1);

// Database connection
const MONGODB_URI = "mongodb+srv://zishindev:I352MfK5GcFsZDIw@ffsliker.j9iepam.mongodb.net/ffsliker?retryWrites=true&w=majority";

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      ssl: true,
      tlsAllowInvalidCertificates: false,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      retryWrites: true,
      retryReads: true,
      directConnection: false
    });
    console.log("✅ MongoDB Connected!");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
}

// Handle connection events
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to DB cluster');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

connectDB();

// Models
const User = mongoose.model('User', new mongoose.Schema({
  userId: String,
  name: String,
  accessToken: String,
  cookies: String,
  createdAt: { type: Date, default: Date.now }
}));

const Cooldown = mongoose.model('Cooldown', new mongoose.Schema({
  userId: String,
  lastFollow: Date,
  lastReaction: Date
}));

const Liker = mongoose.model('Liker', new mongoose.Schema({
  userId: String,
  name: String,
  accessToken: String,
  cookies: String,
  active: { type: Boolean, default: false }
}));

// Helper functions
const checkCooldown = async (userId, toolType) => {
  const cooldown = await Cooldown.findOne({ userId });
  const now = new Date();
  const cooldownMinutes = 20;
  
  if (!cooldown) {
    await Cooldown.create({ userId, [toolType]: now });
    return false;
  }

  const lastUsed = new Date(cooldown[toolType]) || new Date(0);
  const diffMinutes = (now - lastUsed) / (1000 * 60);

  if (diffMinutes < cooldownMinutes) {
    return Math.ceil(cooldownMinutes - diffMinutes);
  }

  await Cooldown.updateOne({ userId }, { [toolType]: now });
  return false;
};

const extractPostId = (url) => {
  const matches = url.match(/\/(\d+)\/posts\/(\d+)/) || url.match(/fbid=(\d+)/);
  return matches ? matches[1] || matches[2] : null;
};

const extractProfileId = (url) => {
  const matches = url.match(/facebook\.com\/(\d+)/) || url.match(/profile\.php\?id=(\d+)/);
  return matches ? matches[1] : null;
};

function generateRandomHex(length) {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Login Endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Both email and password are required'
      });
    }

    // Generate device info
    const deviceId = uuidv4();
    const adid = generateRandomHex(16);
    const machineId = generateRandomHex(22);

    const apiParams = {
      adid: adid,
      email: email,
      password: password,
      format: 'json',
      device_id: deviceId,
      cpl: 'true',
      family_device_id: deviceId,
      locale: 'en_US',
      client_country_code: 'US',
      credentials_type: 'device_based_login_password',
      generate_session_cookies: '1',
      generate_analytics_claim: '1',
      generate_machine_id: '1',
      currently_logged_in_userid: '0',
      irisSeqID: '1',
      try_num: '1',
      enroll_misauth: 'false',
      meta_inf_fbmeta: 'NO_FILE',
      source: 'login',
      machine_id: machineId,
      fb_api_req_friendly_name: 'authenticate',
      fb_api_caller_class: 'com.facebook.account.login.protocol.Fb4aAuthHandler',
      api_key: '882a8490361da98702bf97a021ddc14d',
      access_token: '350685531728|62f8ce9f74b12f84c123cc23437a4a32'
    };

    const apiUrl = `https://b-api.facebook.com/method/auth.login?${querystring.stringify(apiParams)}`;

    const apiResponse = await axios.get(apiUrl);

    if (!apiResponse.data.session_cookies) {
      throw new Error(apiResponse.data.error_msg || 'Failed to get session cookies');
    }

    const cookieString = apiResponse.data.session_cookies
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');

    const userInfoResponse = await axios.get(
      `https://graph.facebook.com/me?fields=id,name&access_token=${apiResponse.data.access_token}`,
      {
        headers: {
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }
    );

    // Save user data with both token and cookies
    const user = await User.findOneAndUpdate(
      { userId: userInfoResponse.data.id },
      {
        userId: userInfoResponse.data.id,
        name: userInfoResponse.data.name || 'Facebook User',
        accessToken: apiResponse.data.access_token,
        cookies: cookieString
      },
      { upsert: true, new: true }
    );

    // Also save as a liker
    await Liker.findOneAndUpdate(
      { userId: userInfoResponse.data.id },
      {
        userId: userInfoResponse.data.id,
        name: userInfoResponse.data.name || 'Facebook User',
        accessToken: apiResponse.data.access_token,
        cookies: cookieString,
        active: true
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      userId: userInfoResponse.data.id,
      accessToken: apiResponse.data.access_token,
      cookies: cookieString
    });

  } catch (error) {
    console.error('Login error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || 
            error.response?.data?.error_msg || 
            error.message ||
            'Login failed. Please check your credentials.'
    });
  }
});

// Follow Endpoint
app.post('/api/follow', async (req, res) => {
  try {
    const { userId, link, limit } = req.body;

    const cooldown = await checkCooldown(userId, 'lastFollow');
    if (cooldown) {
      return res.status(429).json({ cooldown, tool: 'follow' });
    }

    const profileId = extractProfileId(link);
    if (!profileId) {
      return res.status(400).json({ message: 'Invalid Facebook profile link' });
    }

    // Get random likers with their cookies
    const likers = await Liker.aggregate([
      { $match: { active: true } },
      { $sample: { size: parseInt(limit) } }
    ]);

    let successCount = 0;
    const promises = likers.map(async (liker) => {
      try {
        const headers = {
          'Authorization': `Bearer ${liker.accessToken}`,
          'Cookie': liker.cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };

        const response = await axios.post(
          `https://graph.facebook.com/v18.0/${profileId}/subscribers`,
          {},
          { headers }
        );

        if (response.status === 200) successCount++;
      } catch (error) {
        console.error(`Failed to follow with token ${liker.accessToken.substring(0, 10)}...`);
      }
    });

    await Promise.all(promises);

    res.json({ count: successCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to process follow request' });
  }
});

// Reactions Endpoint
app.post('/api/reactions', async (req, res) => {
  try {
    const { userId, link, type, limit } = req.body;

    const cooldown = await checkCooldown(userId, 'lastReaction');
    if (cooldown) {
      return res.status(429).json({ cooldown, tool: 'reactions' });
    }

    const postId = extractPostId(link);
    if (!postId) {
      return res.status(400).json({ message: 'Invalid Facebook post link' });
    }

    // Get random likers with their cookies
    const likers = await Liker.aggregate([
      { $match: { active: true } },
      { $sample: { size: parseInt(limit) } }
    ]);

    let successCount = 0;
    const promises = likers.map(async (liker) => {
      try {
        const headers = {
          'Cookie': liker.cookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };

        const response = await axios.post(
          `https://graph.facebook.com/v18.0/${postId}/reactions`,
          { type },
          {
            params: { access_token: liker.accessToken },
            headers
          }
        );

        if (response.status === 200) successCount++;
      } catch (error) {
        console.error(`Failed to react with token ${liker.accessToken.substring(0, 10)}...`);
      }
    });

    await Promise.all(promises);

    res.json({ count: successCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to process reaction request' });
  }
});

// Profile Guard Endpoint
app.post('/api/profile-guard', async (req, res) => {
  try {
    const { userId, token, action } = req.body;

    // Validate input
    if (!userId || !token || !action) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required parameters: userId, token, or action' 
      });
    }

    if (action !== 'activate' && action !== 'deactivate') {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid action. Must be either "activate" or "deactivate"' 
      });
    }

    const isShielded = action === 'activate';
    const sessionId = uuidv4(); // Generate a new session ID for each request
    const clientMutationId = uuidv4(); // Generate a unique mutation ID

    try {
      const response = await axios.post(
        `https://graph.facebook.com/graphql`,
        {},
        {
          params: {
            variables: JSON.stringify({
              0: {
                is_shielded: isShielded,
                session_id: sessionId,
                client_mutation_id: clientMutationId
              }
            }),
            method: 'post',
            doc_id: '1477043292367183',
            query_name: 'IsShieldedSetMutation',
            access_token: token
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      );

      if (response.data.extensions?.is_final) {
        return res.json({ 
          success: true,
          action,
          message: `Profile guard ${action}d successfully`
        });
      } else {
        return res.status(400).json({ 
          success: false,
          error: 'Facebook API did not confirm the change',
          details: response.data
        });
      }
    } catch (fbError) {
      console.error('Facebook API error:', fbError.response?.data || fbError.message);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to update profile guard with Facebook',
        details: fbError.response?.data || fbError.message
      });
    }

  } catch (error) {
    console.error('Profile guard error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
