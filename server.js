require('dotenv').config();
console.log("Loaded SID:", process.env.TWILIO_ACCOUNT_SID); // Debug
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
// Import Routes
const matchRoutes = require('./routes/matches');
const playerRoutes = require('./routes/players');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const availabilityRoutes = require('./routes/availability');
const matchRequestRoutes = require('./routes/matchRequests');
const twilio = require('twilio');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialize Twilio client if credentials are available
let client;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    global.twilioClient = client;
}

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://127.0.0.1:5502', 'http://localhost:5502'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Content-Type', 'Authorization'],
  credentials: true
}));

// Serve static files from the public directory
app.use(express.static('public'));
app.use(express.static(__dirname + '/public'));

// Body parsing middleware - MUST be before routes
app.use(express.urlencoded({ extended: true }));

// Debug middleware to log all requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method === 'POST' || req.method === 'PUT') {
        console.log('Request body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// Add error handling for JSON parsing
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('JSON Parse Error:', err);
        return res.status(400).json({ 
            message: 'Invalid JSON payload',
            error: err.message 
        });
    }
    next(err);
});

// DB Connection
const db = "mongodb://127.0.0.1:27017/playersBooking";
mongoose.set('strictQuery', true);

// Improved MongoDB connection with retry logic
const connectDB = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(db, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
            });
            console.log('MongoDB Connected Successfully');
            return;
        } catch (err) {
            console.error(`MongoDB Connection Attempt ${i + 1} Failed:`, err.message);
            if (i === retries - 1) {
                console.error('All connection attempts failed. Exiting...');
                process.exit(1);
            }
            // Wait 2 seconds before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
};

connectDB();

// Handle MongoDB connection errors after initial connection
mongoose.connection.on('error', err => {
    console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected. Attempting to reconnect...');
    connectDB();
});

// WebSocket Connection Management
const connectedUsers = new Map(); // userId -> socket.id

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('new-availability', (data) => {
        // Broadcast to all connected clients except sender
        socket.broadcast.emit('new-availability', data);
    });

    socket.on('matchRequestSent', async (data) => {
        try {
            const { receiverId } = data;
            const receiverSocketId = connectedUsers.get(receiverId);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('newMatchRequest', data);
            }
        } catch (error) {
            console.error('Error handling match request:', error);
        }
    });

    socket.on('matchRequestUpdated', async (data) => {
        try {
            const { senderId, receiverId } = data;
            // Notify both sender and receiver
            [senderId, receiverId].forEach(userId => {
                const userSocketId = connectedUsers.get(userId);
                if (userSocketId) {
                    io.to(userSocketId).emit('matchRequestUpdated', data);
                }
            });
        } catch (error) {
            console.error('Error handling match request update:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// API Routes
app.use('/api/matches', matchRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/match-requests', matchRequestRoutes);

// Test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working' });
});

// Test route for Twilio WhatsApp
app.get('/api/test-whatsapp', async (req, res) => {
    try {
        const message = await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: 'whatsapp:+916374561199', // Your registered test number
            body: 'Hello! This is a test message from your sports booking app.'
        });
        res.json({ success: true, messageId: message.sid });
    } catch (error) {
        console.error('Twilio test error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Webhook for Twilio WhatsApp responses
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        const { From, Body, MessageSid } = req.body;
        const response = Body.toLowerCase();
        
        // Find the friend request by WhatsApp message ID
        const Friend = require('./models/Friend');
        const friendRequest = await Friend.findOne({ whatsappMessageId: MessageSid })
            .populate('sender')
            .populate('receiver');

        if (!friendRequest) {
            console.log('No matching friend request found for message:', MessageSid);
            return res.sendStatus(200);
        }

        if (response === 'yes') {
            // Accept friend request
            friendRequest.status = 'accepted';
            await friendRequest.save();

            // Add users to each other's friends list
            const User = require('./models/User');
            await User.updateOne(
                { _id: friendRequest.sender._id },
                { $addToSet: { friends: friendRequest.receiver._id } }
            );
            await User.updateOne(
                { _id: friendRequest.receiver._id },
                { $addToSet: { friends: friendRequest.sender._id } }
            );

            // Notify sender via WhatsApp
            await client.messages.create({
                from: process.env.TWILIO_WHATSAPP_NUMBER,
                to: `whatsapp:${friendRequest.sender.whatsappNumber}`,
                body: `Your request has been accepted by the player!\nPlayer Contact: ${friendRequest.receiver.username}, ${friendRequest.receiver.phoneNumber}\nYou may now connect and team up.`
            });

            // Notify sender via WebSocket if online
            const senderSocketId = connectedUsers.get(friendRequest.sender._id.toString());
            if (senderSocketId) {
                io.to(senderSocketId).emit('friendRequestAccepted', {
                    friendId: friendRequest.receiver._id,
                    friendName: friendRequest.receiver.username
                });
            }
        } else if (response === 'no') {
            // Reject friend request
            friendRequest.status = 'rejected';
            await friendRequest.save();

            // Notify sender via WhatsApp
            await client.messages.create({
                from: process.env.TWILIO_WHATSAPP_NUMBER,
                to: `whatsapp:${friendRequest.sender.whatsappNumber}`,
                body: `Sorry, your connection request was declined by the player.`
            });

            // Notify sender via WebSocket if online
            const senderSocketId = connectedUsers.get(friendRequest.sender._id.toString());
            if (senderSocketId) {
                io.to(senderSocketId).emit('friendRequestRejected', {
                    friendId: friendRequest.receiver._id,
                    friendName: friendRequest.receiver.username
                });
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
    }
});

// Catch-all route for undefined routes
app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.url}`);
    res.status(404).json({ message: 'Route not found' });
});

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    
    // Handle Mongoose validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            message: 'Validation Error',
            errors: Object.values(err.errors).map(e => e.message)
        });
    }
    
    // Handle Mongoose cast errors
    if (err.name === 'CastError') {
        return res.status(400).json({
            message: 'Invalid Data Format',
            error: `Invalid ${err.path}: ${err.value}`
        });
    }

    // Handle other known errors
    if (err.status && err.message) {
        return res.status(err.status).json({
            message: err.message
        });
    }

    // Handle unknown errors
    res.status(500).json({
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
    });
});

// Start server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Export for testing/inspection
module.exports = app; 