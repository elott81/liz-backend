// backend/server.js for Liz
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection (use a new database or the same one with a different collection)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Code Schema
const codeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  encryptedCode: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Code = mongoose.model('Code', codeSchema);

// Session Schema to track active logins
const sessionSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  deviceId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: '7d' },
});

const Session = mongoose.model('Session', sessionSchema);

// Encryption Functions
const algorithm = 'aes-256-cbc';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const iv = Buffer.from(process.env.ENCRYPTION_IV, 'hex');

function encrypt(text) {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// Function to generate a random 12-character code
function generateRandomCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  const codeLength = 12;
  let code = '';
  const bytes = crypto.randomBytes(codeLength);
  for (let i = 0; i < codeLength; i++) {
    code += characters.charAt(bytes[i] % characters.length);
  }
  return code;
}

// Ping Endpoint to Keep Service Awake
app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// API Endpoint to Validate Code and Manage Sessions
app.post('/api/verify-code', async (req, res) => {
  const { code, deviceId } = req.body;
  if (!code || !deviceId) return res.status(400).json({ error: 'Code and deviceId required' });

  try {
    const storedCode = await Code.findOne({ encryptedCode: encrypt(code) });
    if (!storedCode) {
      return res.json({ valid: false });
    }

    const existingSession = await Session.findOne({ code });
    if (existingSession && existingSession.deviceId !== deviceId) {
      return res.status(403).json({ error: 'This code is already in use on another device.' });
    }

    await Session.findOneAndUpdate(
      { code },
      { code, deviceId },
      { upsert: true, new: true }
    );

    res.json({ valid: true });
  } catch (error) {
    console.error('Code validation error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint to Logout (Remove Session)
app.post('/api/logout', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  try {
    await Session.deleteOne({ code });
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint for OpenAI Chat
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'Messages required' });

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.8,
        max_tokens: 150,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('OpenAI Error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Seed Initial Codes (Run once)
async function seedCodes() {
  const codeCount = await Code.countDocuments();
  if (codeCount === 0) {
    await Code.deleteMany({});
    const codes = [];
    for (let i = 0; i < 10; i++) {
      const code = generateRandomCode();
      const encrypted = encrypt(code);
      codes.push({ code, encryptedCode: encrypted });
    }
    await Code.insertMany(codes);
    console.log('10 random codes seeded:', codes.map(c => c.code));
  } else {
    console.log('Codes already exist in the database, skipping seeding.');
  }
}

seedCodes();