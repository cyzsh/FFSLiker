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
      tlsAllowInvalidCertificates: false, // Strict SSL
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      retryWrites: true,
      retryReads: true,
      directConnection: false // Important for Atlas
    });
    console.log("✅ MongoDB Connected!");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    // Implement retry logic here if needed
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
  cookies: String, // Stored as "key1=value1; key2=value2"
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
  cookies: String, // Added cookies for likers
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

// Updated Login Endpoint with Cookie Support
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Both email and password are required'
      });
    }

    // Generate Android-style device info
    const device_id = uuidv4();
    const family_device_id = uuidv4();
    const secure_family_device_id = uuidv4();
    const machine_id = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
    const jazoest = Math.floor(22000 + Math.random() * 1000);
    const timestamp = Math.floor(Date.now() / 1000);

    const headers = {
      'Host': 'b-graph.facebook.com',
      'X-Fb-Connection-Quality': 'EXCELLENT',
      'Authorization': 'OAuth 350685531728|62f8ce9f74b12f84c123cc23437a4a32',
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 7.1.2; RMX3740 Build/QP1A.190711.020) [FBAN/FB4A;FBAV/417.0.0.33.65;FBPN/com.facebook.katana;FBLC/en_US;FBBV/480086274;FBCR/Corporation Tbk;FBMF/realme;FBBD/realme;FBDV/RMX3740;FBSV/7.1.2;FBCA/x86:armeabi-v7a;FBDM/{density=1.0,width=540,height=960};FB_FW/1;FBRV/483172840;]',
      'x-fb-friendly-name': 'Authenticate',
      'x-fb-connection-type': 'Unknown',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/x-www-form-urlencoded',
      'x-fb-http-engine': 'Liger'
    };

    const data = new URLSearchParams({
      adid: this.generateRandomHex(16),
      format: 'json',
      device_id: uuidv4(),
      email: email,
      password: password,
      generate_analytics_claims: '0',
      credentials_type: 'password',
      source: 'login',
      error_detail_type: 'button_with_disabled',
      enroll_misauth: 'false',
      generate_session_cookies: '1',
      generate_machine_id: '0',
      fb_api_req_friendly_name: 'authenticate',
    });

    const response = await axios.post(
      'https://b-graph.facebook.com/auth/login',
      data,
      { headers }
    );

    if (response.data.access_token && response.data.session_cookies) {
      // Format cookies as string
      const cookieString = response.data.session_cookies
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');

      // Save user data with cookies
      const user = await User.findOneAndUpdate(
        { userId: response.data.uid },
        {
          userId: response.data.uid,
          name: response.data.name || 'Facebook User',
          accessToken: response.data.access_token,
          cookies: cookieString
        },
        { upsert: true, new: true }
      );

      // Also save as a liker
      await Liker.findOneAndUpdate(
        { userId: response.data.uid },
        {
          userId: response.data.uid,
          name: response.data.name || 'Facebook User',
          accessToken: response.data.access_token,
          cookies: cookieString,
          active: true
        },
        { upsert: true, new: true }
      );

      return res.json({
        success: true,
        userId: response.data.uid,
        accessToken: response.data.access_token,
        cookies: cookieString
      });
    } else {
      return res.status(400).json({
        success: false,
        error: response.data.error?.message || 'Login failed'
      });
    }
  } catch (error) {
    console.error('Login error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || 'Login failed'
    });
  }
});

// Updated Follow Endpoint with Cookie Support
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

// Updated Reactions Endpoint with Cookie Support
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

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
