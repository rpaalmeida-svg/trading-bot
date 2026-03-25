const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let latestData = {};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Middleware de autenticação
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Página de login
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Trading Bot — Login</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #0d1117;
          color: #e6edf3;
          font-family: 'Segoe UI', sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
        }
        .login-box {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 16px;
          padding: 40px;
          width: 100%;
          max-width: 400px;
          text-align: center;
        }
        h1 {
          color: #58a6ff;
          margin-bottom: 8px;
          font-size: 1.5rem;
        }
        p {
          color: #8b949e;
          margin-bottom: 30px;
          font-size: 0.9rem;
        }
        input {
          width: 100%;
          padding: 12px 16px;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 8px;
          color: #e6edf3;
          font-size: 1rem;
          margin-bottom: 12px;
          outline: none;
        }
        input:focus {
          border-color: #58a6ff;
        }
        button {
          width: 100%;
          padding: 12px;
          background: #58a6ff;
          color: #0d1117;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: bold;
          cursor: pointer;
          margin-top: 8px;
        }
        button:hover { background: #79b8ff; }
        .error {
          color: #f85149;
          font-size: 0.85rem;
          margin-bottom: 16px;
        }
      </style>
    </head>
    <body>
      <div class="login-box">
        <h1>🤖 Trading Bot</h1>
        <p>Introduz as tuas credenciais para aceder ao dashboard</p>
        ${req.query.error ? '<div class="error">❌ Credenciais incorrectas</div>' : ''}
        <form method="POST" action="/login">
          <input type="text" name="username" placeholder="Utilizador" required autofocus />
          <input type="password" name="password" placeholder="Password" required />
          <button type="submit">Entrar</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Processar login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.DASHBOARD_USER &&
    password === process.env.DASHBOARD_PASSWORD
  ) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard protegido
app.use(requireAuth);
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

io.on('connection', (socket) => {
  console.log('Dashboard ligado');
  if (latestData) {
    socket.emit('update', latestData);
  }
});

function updateDashboard(data) {
  latestData = data;
  io.emit('update', data);
}

function startDashboard(port = 3000) {
  server.listen(port, () => {
    console.log(`Dashboard disponível em http://localhost:${port}`);
  });
}

module.exports = { startDashboard, updateDashboard };