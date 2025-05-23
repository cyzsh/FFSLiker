const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 11000;

// Initialize SQLite database
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      name TEXT,
      accessToken TEXT,
      cookies TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      userId TEXT PRIMARY KEY,
      lastFollow DATETIME,
      lastReaction DATETIME,
      lastProfileGuard DATETIME
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS likers (
      userId TEXT PRIMARY KEY,
      name TEXT,
      accessToken TEXT,
      cookies TEXT,
      active BOOLEAN DEFAULT 0
    )
  `);
});

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

// Helper functions for SQLite
const dbGet = (query, params) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbRun = (query, params) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbAll = (query, params) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Helper functions
const checkCooldown = async (userId, toolType) => {
  const cooldown = await dbGet('SELECT * FROM cooldowns WHERE userId = ?', [userId]);
  const now = new Date();
  const cooldownMinutes = 20;
  
  if (!cooldown) {
    await dbRun(
      'INSERT INTO cooldowns (userId, ' + toolType + ') VALUES (?, ?)',
      [userId, now.toISOString()]
    );
    return false;
  }

  const lastUsed = new Date(cooldown[toolType] || 0);
  const diffMinutes = (now - lastUsed) / (1000 * 60);

  if (diffMinutes < cooldownMinutes) {
    return Math.ceil(cooldownMinutes - diffMinutes);
  }

  await dbRun(
    'UPDATE cooldowns SET ' + toolType + ' = ? WHERE userId = ?',
    [now.toISOString(), userId]
  );
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

// Updated Login Endpoint
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
      'X-Tigon-Is-Retry': 'false',
      'X-Fb-Friendly-Name': 'authenticate',
      'X-Fb-Connection-Bandwidth': Math.floor(70000000 + Math.random() * 10000000).toString(),
      'Zero-Rated': '0',
      'X-Fb-Net-Hni': Math.floor(50000 + Math.random() * 10000).toString(),
      'X-Fb-Sim-Hni': Math.floor(50000 + Math.random() * 10000).toString(),
      'X-Fb-Request-Analytics-Tags': '{"network_tags":{"product":"350685531728","retry_attempt":"0"},"application_tags":"unknown"}',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Fb-Connection-Type': 'WIFI',
      'X-Fb-Device-Group': Math.floor(4700 + Math.random() * 300).toString(),
      'Priority': 'u=3,i',
      'Accept-Encoding': 'gzip, deflate',
      'X-Fb-Http-Engine': 'Liger',
      'X-Fb-Client-Ip': 'true',
      'X-Fb-Server-Cluster': 'true',
      'Content-Length': Math.floor(1500 + Math.random() * 500).toString()
    };

    const data = new URLSearchParams({
      adid: uuidv4(),
      format: 'json',
      device_id: device_id,
      email: email,
      password: password,
      generate_analytics_claim: '1',
      community_id: '',
      linked_guest_account_userid: '',
      cpl: 'true',
      try_num: '1',
      family_device_id: family_device_id,
      secure_family_device_id: secure_family_device_id,
      credentials_type: 'password',
      account_switcher_uids: '[]',
      fb4a_shared_phone_cpl_experiment: 'fb4a_shared_phone_nonce_cpl_at_risk_v3',
      fb4a_shared_phone_cpl_group: 'enable_v3_at_risk',
      enroll_misauth: 'false',
      generate_session_cookies: '1',
      error_detail_type: 'button_with_disabled',
      source: 'login',
      machine_id: machine_id,
      jazoest: jazoest.toString(),
      meta_inf_fbmeta: 'V2_UNTAGGED',
      advertiser_id: uuidv4(),
      encrypted_msisdn: '',
      currently_logged_in_userid: '0',
      locale: 'en_US',
      client_country_code: 'US',
      fb_api_req_friendly_name: 'authenticate',
      fb_api_caller_class: 'Fb4aAuthHandler',
      api_key: '882a8490361da98702bf97a021ddc14d',
      sig: require('crypto').createHash('md5').update(uuidv4()).digest('hex').slice(0, 32),
      access_token: '350685531728|62f8ce9f74b12f84c123cc23437a4a32'
    }).toString();

    const response = await axios.post(
      'https://b-graph.facebook.com/auth/login',
      data,
      { headers }
    );

    if (response.data.access_token && response.data.session_cookies) {
      const cookieString = response.data.session_cookies
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');

      // Save user data
      await dbRun(
        'INSERT OR REPLACE INTO users (userId, name, accessToken, cookies) VALUES (?, ?, ?, ?)',
        [response.data.uid, response.data.name || 'Facebook User', response.data.access_token, cookieString]
      );

      // Save as liker
      await dbRun(
        'INSERT OR REPLACE INTO likers (userId, name, accessToken, cookies, active) VALUES (?, ?, ?, ?, 1)',
        [response.data.uid, response.data.name || 'Facebook User', response.data.access_token, cookieString]
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

// Updated Follow Endpoint
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

    // Get random active likers
    const likers = await dbAll(
      'SELECT * FROM likers WHERE active = 1 ORDER BY RANDOM() LIMIT ?',
      [parseInt(limit)]
    );

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

// Updated Reactions Endpoint
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

    // Get random active likers
    const likers = await dbAll(
      'SELECT * FROM likers WHERE active = 1 ORDER BY RANDOM() LIMIT ?',
      [parseInt(limit)]
    );

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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Close DB connection on exit
process.on('SIGINT', () => {
  db.close();
  process.exit();
});
