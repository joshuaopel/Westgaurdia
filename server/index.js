require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const charRoutes = require('./routes/characters');
const worldRoutes = require('./routes/world');
const gmRoutes = require('./routes/gm');
const { registerHandlers } = require('./socket/handlers');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '../client');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(CLIENT_DIR));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/characters', charRoutes);
app.use('/api/world', worldRoutes);
app.use('/api/gm', gmRoutes);

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

// Socket.IO
registerHandlers(io);

server.listen(PORT, () => {
  console.log(`\n  ██╗    ██╗███████╗███████╗████████╗`);
  console.log(`  ██║    ██║██╔════╝██╔════╝╚══██╔══╝`);
  console.log(`  ██║ █╗ ██║█████╗  ███████╗   ██║   `);
  console.log(`  ██║███╗██║██╔══╝  ╚════██║   ██║   `);
  console.log(`  ╚███╔███╔╝███████╗███████║   ██║   `);
  console.log(`   ╚══╝╚══╝ ╚══════╝╚══════╝   ╚═╝   `);
  console.log(`  ██████╗  █████╗ ██╗   ██╗ ██████╗  `);
  console.log(`  ██╔══██╗██╔══██╗██║   ██║██╔══██╗  `);
  console.log(`  ██████╔╝███████║██║   ██║██║  ██║  `);
  console.log(`  ██╔═══╝ ██╔══██║██║   ██║██║  ██║  `);
  console.log(`  ██║     ██║  ██║╚██████╔╝╚██████╔╝  `);
  console.log(`  ╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝  `);
  console.log(`\n  Westgaurdia MMO running on http://localhost:${PORT}\n`);
});
