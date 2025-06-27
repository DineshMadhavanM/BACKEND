const express = require('express');
const router = express.Router();
const MatchRequest = require('../models/MatchRequest');
const User = require('../models/User');
const Availability = require('../models/Availability');

// @route   POST /api/match-requests
// @desc    Create a new match request and send WhatsApp message
// @access  Public
router.post('/', async (req, res) => {
    try {
        console.log("Received body:", req.body);
        const {
            senderName,
            senderPhone,
            receiverPhone,
            date,
            timeFrom,
            timeTo,
            place,
            matchType,
            userId,
            status
        } = req.body;

        if (!senderName || !senderPhone || !receiverPhone || !date || !timeFrom || !timeTo || !place || !matchType || !userId) {
            console.log("Validation failed fields:", { senderName, senderPhone, receiverPhone, date, timeFrom, timeTo, place, matchType, userId });
            return res.status(400).json({ error: "Validation failed: Missing required fields" });
        }

        // Validate and convert date
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format" });
        }

        // Create new match request
        const newRequest = new MatchRequest({
            senderName,
            senderPhone,
            receiverPhone,
            date: dateObj,
            timeFrom,
            timeTo,
            place,
            matchType,
            userId,
            status: (status || 'pending').toLowerCase()
        });

        console.log("Attempting to save request:", newRequest);

        // Save to database
        await newRequest.save();

        // Optional: Send WhatsApp message if Twilio is configured
        if (global.twilioClient) {
            try {
                const formattedDate = dateObj.toLocaleDateString();
                const message = `Player ${senderName} wants to play at ${place} on ${formattedDate} from ${timeFrom} to ${timeTo}. Reply YES or NO.`;
                const twilioMessage = await global.twilioClient.messages.create({
                    from: `whatsapp:+916374561199`,
                    to: `whatsapp:+91${receiverPhone}`,
                    body: message
                });
                newRequest.whatsappMessageId = twilioMessage.sid;
                await newRequest.save();
            } catch (whatsappError) {
                console.error('WhatsApp sending error:', whatsappError);
                // Continue even if WhatsApp fails
            }
        }

        res.status(201).json({
            message: "Match request sent successfully",
            requestId: newRequest._id
        });

    } catch (err) {
        console.error("❌ Backend error:", err);
        res.status(500).json({ error: "Server error while saving match request", details: err.message });
    }
});

// @route   GET /api/match-requests
// @desc    Get match requests for a user
// @access  Public
router.get('/', async (req, res) => {
    try {
        const { phone, status } = req.query;
        const query = {};

        if (phone) {
            query.$or = [{ senderPhone: phone }, { receiverPhone: phone }];
        }

        if (status) {
            query.status = status;
        }

        const requests = await MatchRequest.find(query)
            .sort('-createdAt');

        res.json(requests);
    } catch (error) {
        console.error('Error getting match requests:', error);
        res.status(500).json({ message: 'Error getting match requests', error: error.message });
    }
});

// @route   PUT /api/match-requests/:id
// @desc    Update match request status
// @access  Public
router.put('/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const request = await MatchRequest.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true }
        );
        
        if (!request) {
            return res.status(404).json({ error: "Match request not found" });
        }
        
        res.json(request);
    } catch (err) {
        console.error("Error updating match request:", err);
        res.status(500).json({ error: "Error updating match request" });
    }
});

// @route   DELETE /api/match-requests/:id
// @desc    Cancel a match request
// @access  Public
router.delete('/:id', async (req, res) => {
    try {
        const request = await MatchRequest.findByIdAndDelete(req.params.id);
        
        if (!request) {
            return res.status(404).json({ error: "Match request not found" });
        }
        
        res.json({ message: "Match request deleted successfully" });
    } catch (err) {
        console.error("Error deleting match request:", err);
        res.status(500).json({ error: "Error deleting match request" });
    }
});

// @route   POST /api/match-requests/bulk
// @desc    Send bulk match requests
// @access  Public
router.post('/bulk', async (req, res) => {
    try {
        const { senderName, senderPhone, receiverPhones, date, timeFrom, timeTo, place, matchType } = req.body;

        if (!senderName || !senderPhone || !receiverPhones || !date || !timeFrom || !timeTo || !place || !matchType) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const requests = [];
        const errors = [];

        // Create requests for each receiver
        for (const receiverPhone of receiverPhones) {
            try {
                // Check for existing pending request
                const existingRequest = await MatchRequest.findOne({
                    senderPhone,
                    receiverPhone,
                    date: new Date(date),
                    status: 'pending'
                });

                if (existingRequest) {
                    errors.push(`Already have a pending request with ${receiverPhone}`);
                    continue;
                }

                const matchRequest = new MatchRequest({
                    senderName,
                    senderPhone,
                    receiverPhone,
                    date: new Date(date),
                    timeFrom,
                    timeTo,
                    place,
                    matchType,
                    status: 'pending'
                });

                await matchRequest.save();

                // Send WhatsApp notification
                if (global.twilioClient) {
                    try {
                        const message = `New match request from ${senderName}!\n` +
                                      `Date: ${new Date(date).toLocaleDateString()}\n` +
                                      `Time: ${timeFrom} - ${timeTo}\n` +
                                      `Place: ${place}\n\n` +
                                      `Reply 'yes' to accept or 'no' to decline.`;

                        const twilioMessage = await global.twilioClient.messages.create({
                            from: `whatsapp:+916374561199`,
                            to: `whatsapp:+91${receiverPhone}`,
                            body: message
                        });

                        matchRequest.whatsappMessageId = twilioMessage.sid;
                        await matchRequest.save();
                    } catch (error) {
                        console.error('Error sending WhatsApp notification:', error);
                        // Continue even if WhatsApp notification fails
                    }
                }

                requests.push(matchRequest);
            } catch (error) {
                errors.push(`Error creating request for ${receiverPhone}: ${error.message}`);
            }
        }

        res.status(201).json({
            success: true,
            requests,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Error creating bulk match requests:', error);
        res.status(500).json({ message: 'Error creating bulk match requests', error: error.message });
    }
});

// Export the router
module.exports = router; 