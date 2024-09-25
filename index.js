const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const socketIo = require('socket.io');
var authRoutes = require('./routes/auth');
var fileRoutes = require('./routes/file');
const LinkRequest = require('./models/LinkRequest');
const FileTransferMeta = require('./models/FileTransferMeta');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/fileTransferApp', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/file', fileRoutes);
try{
app.use('/auth', authRoutes);

}catch(err){
  console.error("error from auth",err);
}
// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack); // Log the error stack
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

// WebSocket Connection
const clients = {}; // Store clients with their user IDs

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Register user
  socket.on('register', (userId) => {
    clients[userId] = socket;
    console.log(`User registered: ${userId}`);
  });

  // Handle incoming link requests
  socket.on('send-link-request', async (data) => {
    try {
      const { from, to, link } = data;
      const targetClient = clients[to];

      if (targetClient) {
        targetClient.emit('link-request', { from, link });
        let linkRequest = await LinkRequest.findOne({ userId: to });
        if (!linkRequest) {
          linkRequest = new LinkRequest({ userId: to, requests: [] });
        }
        linkRequest.requests.push({ senderId: from, link });
        await linkRequest.save();
      }
    } catch (error) {
      console.error('Error sending link request:', error);
    }
  });

  // Handle link response
  socket.on('send-link-response', async (data) => {
    try {
      const { from, to, accepted } = data;
      const requester = clients[from];

      const linkRequest = await LinkRequest.findOne({ userId: to });
      if (linkRequest) {
        const request = linkRequest.requests.find(req => req.senderId === from);
        if (request) {
          request.accepted = accepted;
          await linkRequest.save();
        }
      }

      if (accepted) {
        requester.emit('link-accepted', { from });
      } else {
        requester.emit('link-declined', { from });
      }
    } catch (error) {
      console.error('Error processing link response:', error);
    }
  });

  // Handle file transfer in chunks
  socket.on('send-file-chunk', async (data) => {
    try {
      const { recipientId, fileName, chunkData, chunkIndex, totalChunks } = data;

      // Store metadata for the transfer
      await FileTransferMeta.updateOne(
        { senderId: socket.id, recipientId, fileName },
        { $set: { currentChunk: chunkIndex, totalChunks } },
        { upsert: true }
      );

      // Check if the recipient accepted the link
      const linkRequest = await LinkRequest.findOne({ userId: recipientId });
      if (linkRequest) {
        const request = linkRequest.requests.find(req => req.senderId === socket.id);
        if (request && request.accepted) {
          const recipientSocket = clients[recipientId];
          if (recipientSocket) {
            recipientSocket.emit('file-chunk-received', { fileName, chunkData, chunkIndex });
          }
        }
      }
    } catch (error) {
      console.error('Error sending file chunk:', error);
    }
  });

  // Handle file completion
  socket.on('complete-file-transfer', async (data) => {
    try {
      const { recipientId, fileName } = data;

      // Clean up chunks after successful transfer
      await FileTransferMeta.deleteMany({ recipientId, fileName }); // Clean up metadata
    } catch (error) {
      console.error('Error completing file transfer:', error);
    }
  });

  // Check for metadata on reconnect
  socket.on('check-file-transfer', async (recipientId, senderId) => {
    try {
      const transferMeta = await FileTransferMeta.findOne({ senderId, recipientId });
      if (transferMeta) {
        socket.emit('resume-file-transfer', transferMeta);
      }
    } catch (error) {
      console.error('Error checking file transfer:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    for (const [userId, client] of Object.entries(clients)) {
      if (client === socket) {
        delete clients[userId]; // Remove client on disconnect
        await LinkRequest.deleteMany({ userId });
        console.log(`User disconnected: ${userId}`);
        break;
      }
    }
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
