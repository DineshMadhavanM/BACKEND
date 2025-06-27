const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Friend = require('../models/Friend');
const twilio = require('twilio');

// Log Twilio Account SID
console.log("SID:", process.env.TWILIO_ACCOUNT_SID); // Should start with AC

// Initialize Twilio client
const client = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const COMPANY_WHATSAPP_NUMBER = 'whatsapp:+916374561199';

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { username, email, phoneNumber, whatsappNumber, dob, location, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [
                { username },
                { email },
                { phoneNumber }
            ]
        });

        if (existingUser) {
            return res.status(400).json({
                message: 'User already exists with this username, email, or phone number'
            });
        }

        // Create new user
        const user = new User({
            username,
            email,
            phoneNumber,
            whatsappNumber,
            dob,
            location,
            password
        });

        await user.save();

        res.status(201).json({
            message: 'User registered successfully',
            userId: user._id
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Error registering user' });
    }
});

// Get all users (for admin panel)
router.get('/', async (req, res) => {
    try {
        const users = await User.find()
            .select('-password')
            .lean();
        
        // Update online status for each user
        const usersWithStatus = users.map(user => {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const isOnline = user.lastActivity > fiveMinutesAgo;
            return { ...user, isOnline };
        });

        res.json(usersWithStatus);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// Send friend request
router.post('/friend-request', async (req, res) => {
    try {
        const { senderUserId, receiverPhone } = req.body;

        // Find receiver by phone number
        const receiver = await User.findOne({ phoneNumber: receiverPhone });
        if (!receiver) {
            return res.status(404).json({ message: 'User not found with this phone number' });
        }

        // Check if request already exists
        const existingRequest = await Friend.findOne({
            sender: senderUserId,
            receiver: receiver._id
        });

        if (existingRequest) {
            return res.status(400).json({ message: 'Friend request already sent' });
        }

        // Create friend request
        const friendRequest = new Friend({
            sender: senderUserId,
            receiver: receiver._id
        });

        await friendRequest.save();

        // Send WhatsApp message to receiver
        if (receiver.whatsappNumber) {
            try {
                const sender = await User.findById(senderUserId);
                const message = await client.messages.create({
                    from: COMPANY_WHATSAPP_NUMBER,
                    to: `whatsapp:${receiver.whatsappNumber}`,
                    body: `Hello! You have a team-up request from a player.\nDo you want to connect with this user?\nReply [Yes] or [No]`
                });

                // Store message ID for tracking responses
                friendRequest.whatsappMessageId = message.sid;
                await friendRequest.save();
            } catch (error) {
                console.error('WhatsApp message error:', error);
            }
        }

        res.status(201).json({ message: 'Friend request sent successfully' });
    } catch (error) {
        console.error('Friend request error:', error);
        res.status(500).json({ message: 'Error sending friend request' });
    }
});

// Handle friend request response
router.post('/friend-request/:requestId/respond', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { response } = req.body;

        const friendRequest = await Friend.findById(requestId)
            .populate('sender')
            .populate('receiver');

        if (!friendRequest) {
            return res.status(404).json({ message: 'Friend request not found' });
        }

        friendRequest.status = response === 'accept' ? 'accepted' : 'rejected';
        await friendRequest.save();

        if (response === 'accept') {
            // Add users to each other's friends list
            await User.updateOne(
                { _id: friendRequest.sender._id },
                { $addToSet: { friends: friendRequest.receiver._id } }
            );
            await User.updateOne(
                { _id: friendRequest.receiver._id },
                { $addToSet: { friends: friendRequest.sender._id } }
            );

            // Send WhatsApp message to sender
            if (friendRequest.sender.whatsappNumber) {
                try {
                    await client.messages.create({
                        from: COMPANY_WHATSAPP_NUMBER,
                        to: `whatsapp:${friendRequest.sender.whatsappNumber}`,
                        body: `Your request has been accepted by the player!\nPlayer Contact: ${friendRequest.receiver.username}, ${friendRequest.receiver.phoneNumber}\nYou may now connect and team up.`
                    });
                } catch (error) {
                    console.error('WhatsApp message error:', error);
                }
            }
        } else {
            // Send rejection message
            if (friendRequest.sender.whatsappNumber) {
                try {
                    await client.messages.create({
                        from: COMPANY_WHATSAPP_NUMBER,
                        to: `whatsapp:${friendRequest.sender.whatsappNumber}`,
                        body: `Sorry, your connection request was declined by the player.`
                    });
                } catch (error) {
                    console.error('WhatsApp message error:', error);
                }
            }
        }

        res.json({ message: `Friend request ${response === 'accept' ? 'accepted' : 'rejected'}` });
    } catch (error) {
        console.error('Friend request response error:', error);
        res.status(500).json({ message: 'Error processing friend request response' });
    }
});

// Update user's last activity
router.post('/:userId/activity', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await user.updateActivity();
        res.json({ message: 'Activity updated' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating activity' });
    }
});

module.exports = router; 