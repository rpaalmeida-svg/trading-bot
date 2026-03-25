const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let latestData = {};

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
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