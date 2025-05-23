const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

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
  lastReaction: Date,
  lastProfileGuard: Date
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

// Enhanced Login Endpoint using b-graph.facebook.com
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
    const adid = generateRandomHex(16);
    const deviceId = uuidv4();

    const headers = {
      'Authorization': 'OAuth 350685531728|62f8ce9f74b12f84c123cc23437a4a32',
      'X-FB-Friendly-Name': 'Authenticate',
      'X-FB-Connection-Type': 'Unknown',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-HTTP-Engine': 'Liger',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
    };

    const data = new URLSearchParams({
      adid: adid,
      format: 'json',
      device_id: deviceId,
      email: email,
      password: password,
      generate_analytics_claims: '0',
      credentials_type: 'password',
      source: 'login',
      error_detail_type: 'button_with_disabled',
      enroll_misauth: 'false',
      generate_session_cookies: '1', // Request session cookies
      generate_machine_id: '0',
      fb_api_req_friendly_name: 'authenticate',
    });

    const response = await axios.post(
      'https://b-graph.facebook.com/auth/login',
      data,
      { headers }
    );

    const responseData = response.data;

    if (responseData.error) {
      return res.status(400).json({
        success: false,
        error: responseData.error.message || 'Login failed'
      });
    }

    if (responseData.access_token && responseData.session_cookies) {
      // Format cookies as string
      const cookieString = responseData.session_cookies
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');

      // Save user data with cookies
      const user = await User.findOneAndUpdate(
        { userId: responseData.uid },
        {
          userId: responseData.uid,
          name: responseData.name || 'Facebook User',
          accessToken: responseData.access_token,
          cookies: cookieString
        },
        { upsert: true, new: true }
      );

      // Also save as a liker
      await Liker.findOneAndUpdate(
        { userId: responseData.uid },
        {
          userId: responseData.uid,
          name: responseData.name || 'Facebook User',
          accessToken: responseData.access_token,
          cookies: cookieString,
          active: true
        },
        { upsert: true, new: true }
      );

      return res.json({
        success: true,
        userId: responseData.uid,
        accessToken: responseData.access_token,
        cookies: cookieString,
        name: responseData.name || 'Facebook User'
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Login failed - no access token received'
      });
    }
  } catch (error) {
    console.error('Login error:', error.response?.data || error.message);
    
    let errorMessage = 'Login failed. Please check your credentials.';
    if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'Facebook API is currently unavailable';
    }

    return res.status(500).json({
      success: false,
      error: errorMessage
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
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
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
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
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

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
