// server.js
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const mongoose = require('mongoose');
const { status } = require('minecraft-server-util');

require('dotenv').config(); // GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MONGO_URI, SESSION_SECRET

const app = express();

// ========== DATABASE ==========
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const serverSchema = new mongoose.Schema({
  name: String,
  host: String,
  port: Number,
  info: String,
  bedrockCompatible: Boolean,
  geyser: Boolean,
  createdBy: String,
  iconUrl: String
});
const Server = mongoose.model('Server', serverSchema);

// ========== AUTH ==========
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== ROUTES ==========
// Google login
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => { req.logout(() => {}); res.redirect('/'); });

// Create a server
app.post('/servers', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).send('Login required');
  const { name, host, port, info, bedrockCompatible, geyser } = req.body;
  try {
    const server = await Server.create({
      name, host, port, info, bedrockCompatible, geyser, createdBy: req.user.id
    });
    res.json(server);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Get server status
async function checkServer(server) {
  try {
    const result = await status(server.host, server.port, { timeout: 4000 });
    return {
      ...server.toObject(),
      online: true,
      players: result.players.online,
      maxPlayers: result.players.max,
      version: result.version.name,
      software: result.version.protocol === 755 ? 'Purpur' : 'Java',
      type: server.bedrockCompatible ? 'Bedrock' : 'Java',
      iconUrl: server.iconUrl || `https://eu.mc-api.net/v3/server/favicon/${server.host}:${server.port}`
    };
  } catch {
    return {
      ...server.toObject(),
      online: false,
      players: 0,
      maxPlayers: 0,
      version: null,
      software: null,
      type: server.bedrockCompatible ? 'Bedrock' : 'Java'
    };
  }
}

app.get('/status', async (req, res) => {
  const servers = await Server.find();
  const data = await Promise.all(servers.map(checkServer));
  res.json(data);
});

// Search servers
app.get('/search', async (req, res) => {
  const query = req.query.q || '';
  const servers = await Server.find({ name: { $regex: query, $options: 'i' } });
  const data = await Promise.all(servers.map(checkServer));
  res.json(data);
});

// Serve frontend directly
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Shan's Ultimate Minecraft Dashboard</title>
<style>
body{margin:0;font-family:sans-serif;background:#0d0d0d;color:#eee;display:flex;flex-direction:column;align-items:center;min-height:100vh;}
h1{margin-top:20px;text-align:center;font-size:2.2rem;color:#00ff99;}
.container{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;width:90%;max-width:1000px;margin-bottom:50px;}
.card{background:#1e1e1e;padding:20px;border-radius:12px;display:flex;flex-direction:column;gap:10px;box-shadow:0 4px 12px rgba(0,0,0,0.5);transition:transform 0.3s;cursor:pointer;}
.card:hover{transform:translateY(-5px)}
.name{font-size:1.3rem;font-weight:700;}
.status{font-weight:700;}
.online{color:#00ff99;}
.offline{color:#ff3860;}
.players{font-size:0.9rem;color:#aaa;}
.button{padding:8px 14px;background:#00ff99;color:#121212;border:none;border-radius:8px;font-weight:700;cursor:pointer;transition:background 0.2s;}
.button:hover{background:#00cc7a;}
.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:none;justify-content:center;align-items:center;z-index:100;}
.modal-content{background:#1e1e1e;padding:30px;border-radius:12px;max-width:500px;width:90%;position:relative;box-shadow:0 4px 20px rgba(0,0,0,0.7);}
.close{position:absolute;top:10px;right:15px;font-size:1.5rem;font-weight:bold;color:#fff;cursor:pointer;}
input{padding:10px;border-radius:8px;border:none;width:250px;margin:10px;}
</style>
</head>
<body>
<h1>Shan's Ultimate Minecraft Dashboard</h1>

<div id="loginArea">
  ${req.isAuthenticated() ? `<div>Logged in as ${req.user.displayName} <a href="/logout" style="color:#00ff99">Logout</a></div>` : `<a href="/auth/google" style="color:#00ff99;font-weight:bold;">Login with Google</a>`}
</div>

<div>
<input id="searchInput" placeholder="Search servers..."/>
<button onclick="searchServers()">Search</button>
</div>

<div class="container" id="container"></div>

<div class="modal" id="modal">
  <div class="modal-content" id="modalContent">
    <span class="close" onclick="closeModal()">&times;</span>
    <div id="modalBody"></div>
  </div>
</div>

<script>
async function fetchStatus(){
  const r=await fetch('/status');
  const data=await r.json();
  renderServers(data);
}

function renderServers(data){
  const container=document.getElementById('container');
  container.innerHTML='';
  data.forEach(s=>{
    const div=document.createElement('div');
    div.className='card';
    div.innerHTML=\`
      <img src="\${s.iconUrl}" style="width:64px;height:64px;border-radius:12px;">
      <div class="name">\${s.name}</div>
      <div class="status \${s.online?'online':'offline'}">\${s.online?'ONLINE':'OFFLINE'}</div>
      <div class="players">Players: \${s.players}/\${s.maxPlayers}</div>
      <div class="info">\${s.info}</div>
      <button class="button" onclick='showModal(\${JSON.stringify(s).replace(/"/g,'&quot;')})'>Show Info</button>
    \`;
    container.appendChild(div);
  });
}

function showModal(server){
  const modal=document.getElementById('modal');
  const body=document.getElementById('modalBody');
  body.innerHTML=\`
    <h2 style="color:#00ff99">\${server.name}</h2>
    <div>Status: <span class="\${server.online?'online':'offline'}">\${server.online?'ONLINE':'OFFLINE'}</span></div>
    <div>Players: \${server.players}/\${server.maxPlayers}</div>
    <div>IP: \${server.host}</div>
    <div>Port: \${server.port}</div>
    <div>Software: \${server.software||'Unknown'}</div>
    <div>Version: \${server.version||'Unknown'}</div>
    <div>Type: \${server.type}</div>
    <div>Bedrock Compatible: \${server.bedrockCompatible}</div>
    <div>Info: \${server.info}</div>
  \`;
  modal.style.display='flex';
}

function closeModal(){ document.getElementById('modal').style.display='none'; }

async function searchServers(){
  const query=document.getElementById('searchInput').value;
  const r=await fetch('/search?q='+query);
  const data=await r.json();
  renderServers(data);
}

fetchStatus();
setInterval(fetchStatus,10000);
</script>

</body>
</html>`);
});

// ========== START SERVER ==========
app.listen(3000, ()=>console.log('Server running on http://localhost:3000'));
