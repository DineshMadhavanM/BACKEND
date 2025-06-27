const express = require('express');
const router = express.Router();
const Availability = require('../models/Availability');
const User = require('../models/User');

// @route   GET /api/availability
// @desc    Get filtered availability
// @access  Public
router.get('/', async (req, res) => {
    try {
        const { date, venue, timeFrom, timeTo, username } = req.query;
        const query = { date: { $gte: new Date() } }; // Default to future dates

        if (date) {
            // Set time to start of day for date comparison
            const searchDate = new Date(date);
            searchDate.setHours(0, 0, 0, 0);
            const nextDay = new Date(searchDate);
            nextDay.setDate(nextDay.getDate() + 1);
            query.date = {
                $gte: searchDate,
                $lt: nextDay
            };
        }

        if (venue) {
            query.preferredVenue = { $regex: venue, $options: 'i' };
        }

        if (timeFrom) {
            query.timeFrom = timeFrom;
        }

        if (timeTo) {
            query.timeTo = timeTo;
        }

        if (username) {
            query.username = { $regex: username, $options: 'i' };
        }

        const availabilities = await Availability.find(query)
            .sort({ date: 1 });

        res.json(availabilities);
    } catch (error) {
        console.error('Error getting filtered availability:', error);
        res.status(500).json({ message: 'Error getting filtered availability', error: error.message });
    }
});

// @route   POST /api/availability
// @desc    Set or update user's availability
// @access  Public
router.post('/', async (req, res) => {
    try {
        console.log('Received availability request:', req.body);
        const { username, phoneNumber, date, timeFrom, timeTo, preferredVenue, gameType } = req.body;

        // Validate required fields
        if (!username || !phoneNumber || !date || !timeFrom || !timeTo || !preferredVenue || !gameType) {
            return res.status(400).json({ 
                message: 'All fields are required',
                missingFields: Object.entries({ username, phoneNumber, date, timeFrom, timeTo, preferredVenue, gameType })
                    .filter(([_, value]) => !value)
                    .map(([key]) => key)
            });
        }

        // Validate game type
        const validGameTypes = ['Cricket', 'Football', 'Tennis', 'Handball', 'Kabaddi'];
        if (!validGameTypes.includes(gameType)) {
            return res.status(400).json({ 
                message: `Invalid game type. Must be one of: ${validGameTypes.join(', ')}`
            });
        }

        // Validate phone number format (10 digits)
        if (!/^\d{10}$/.test(phoneNumber)) {
            return res.status(400).json({ message: 'Phone number must be 10 digits' });
        }

        // Validate username length
        if (username.length < 3) {
            return res.status(400).json({ message: 'Username must be at least 3 characters long' });
        }

        // Validate venue name length
        if (preferredVenue.length < 2) {
            return res.status(400).json({ message: 'Venue name must be at least 2 characters long' });
        }

        // Parse and validate date
        let dateObj;
        try {
            dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) {
                throw new Error('Invalid date');
            }
        } catch (error) {
            console.error('Date parsing error:', error);
            return res.status(400).json({ message: 'Invalid date format' });
        }

        // Validate date is not in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dateObj < today) {
            return res.status(400).json({ message: 'Date must be today or in the future' });
        }

        // Validate time format (HH:mm)
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(timeFrom) || !timeRegex.test(timeTo)) {
            return res.status(400).json({ message: 'Invalid time format. Use HH:mm format' });
        }

        // Convert times to minutes for comparison
        const convertTimeToMinutes = (time) => {
            const [hours, minutes] = time.split(':').map(Number);
            return hours * 60 + minutes;
        };

        const newSlotStart = convertTimeToMinutes(timeFrom);
        const newSlotEnd = convertTimeToMinutes(timeTo);

        // Validate time range
        if (newSlotStart >= newSlotEnd) {
            return res.status(400).json({ message: 'End time must be after start time' });
        }

        // Validate minimum duration (30 minutes)
        if (newSlotEnd - newSlotStart < 30) {
            return res.status(400).json({ message: 'Time slot must be at least 30 minutes' });
        }

        // Validate business hours (6 AM to 10 PM)
        const startHour = Math.floor(newSlotStart / 60);
        if (startHour < 6 || startHour >= 22) {
            return res.status(400).json({ message: 'Please select a time between 6 AM and 10 PM' });
        }

        // Set time to start of day for date comparison
        const searchDate = new Date(dateObj);
        searchDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(searchDate);
        nextDay.setDate(nextDay.getDate() + 1);

        // Check for existing slots on the same date for the same user
        const existingSlots = await Availability.find({
            username,
            date: {
                $gte: searchDate,
                $lt: nextDay
            }
        });

        // Check for time conflicts
        const hasConflict = existingSlots.some(slot => {
            const existingStart = convertTimeToMinutes(slot.timeFrom);
            const existingEnd = convertTimeToMinutes(slot.timeTo);
            return (newSlotStart < existingEnd && newSlotEnd > existingStart);
        });

        if (hasConflict) {
            return res.status(409).json({
                message: 'This time slot conflicts with your existing booking'
            });
        }

        // Create availability
        const availability = new Availability({
            username,
            phoneNumber,
            date: dateObj,
            timeFrom,
            timeTo,
            preferredVenue,
            gameType,
            status: 'available'
        });

        console.log('Attempting to save availability:', availability.toObject());
        const savedAvailability = await availability.save();
        console.log('Availability saved successfully:', savedAvailability.toObject());

        res.status(201).json(savedAvailability);
    } catch (error) {
        console.error('Error setting availability:', error);
        
        // Check for validation errors
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                message: 'Validation error',
                errors: Object.values(error.errors).map(err => err.message)
            });
        }

        // Check for MongoDB errors
        if (error.name === 'MongoError' || error.name === 'MongoServerError') {
            return res.status(500).json({
                message: 'Database error',
                error: error.message
            });
        }

        // Handle other errors
        res.status(500).json({ 
            message: 'Error setting availability',
            error: error.message
        });
    }
});

// @route   GET /api/availability/players
// @desc    Get filtered available players
// @access  Public
router.get('/players', async (req, res) => {
    try {
        const { date, venue, timeFrom, timeTo, username } = req.query;
        const query = { date: { $gte: new Date() } }; // Default to future dates

        if (date) {
            // Set time to start of day for date comparison
            const searchDate = new Date(date);
            searchDate.setHours(0, 0, 0, 0);
            const nextDay = new Date(searchDate);
            nextDay.setDate(nextDay.getDate() + 1);
            query.date = {
                $gte: searchDate,
                $lt: nextDay
            };
        }

        if (venue) {
            query.preferredVenue = { $regex: venue, $options: 'i' };
        }

        if (timeFrom) {
            query.timeFrom = timeFrom;
        }

        if (timeTo) {
            query.timeTo = timeTo;
        }

        if (username) {
            query.username = { $regex: username, $options: 'i' };
        }

        const availabilities = await Availability.find(query)
            .sort({ date: 1 });

        res.json(availabilities);
    } catch (error) {
        console.error('Error getting available players:', error);
        res.status(500).json({ message: 'Error getting available players', error: error.message });
    }
});

// @route   GET /api/availability/friends/:username
// @desc    Get availability of user's friends
// @access  Public
router.get('/friends/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).populate('friends');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const friendIds = user.friends.map(friend => friend._id);
        const friendsAvailability = await Availability.find({
            username: { $in: friendIds },
            date: { $gte: new Date() }
        }).populate('username', 'location isOnline');

        res.json(friendsAvailability);
    } catch (error) {
        console.error('Error getting friends availability:', error);
        res.status(500).json({ message: 'Error getting friends availability', error: error.message });
    }
});

// @route   GET /api/availability/:username
// @desc    Get user's availability
// @access  Public
router.get('/:username', async (req, res) => {
    try {
        const availability = await Availability.find({ 
            username: req.params.username,
            date: { $gte: new Date() } // Only get future availability
        }).sort({ date: 1 });

        res.json(availability);
    } catch (error) {
        console.error('Error getting availability:', error);
        res.status(500).json({ message: 'Error getting availability', error: error.message });
    }
});

// Export the router
module.exports = router; 