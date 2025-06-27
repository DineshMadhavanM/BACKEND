const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, email, phoneNumber, password, dob, location } = req.body;

        // Validate required fields
        if (!username || !email || !phoneNumber || !password || !dob || !location) {
            return res.status(400).json({ msg: 'Please enter all fields' });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ msg: 'Please enter a valid email address' });
        }

        // Validate phone number format (10 digits)
        const phoneRegex = /^\d{10}$/;
        if (!phoneRegex.test(phoneNumber)) {
            return res.status(400).json({ msg: 'Please enter a valid 10-digit phone number' });
        }

        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({ msg: 'Password must be at least 6 characters long' });
        }

        // Check for existing user
        let user = await User.findOne({ $or: [{ email }, { username }, { phoneNumber }] });
        if (user) {
            if (user.email === email) {
                return res.status(400).json({ msg: 'User with this email already exists' });
            }
            if (user.username === username) {
                return res.status(400).json({ msg: 'This username is already taken' });
            }
            if (user.phoneNumber === phoneNumber) {
                return res.status(400).json({ msg: 'This phone number is already registered' });
            }
        }

        // Create new user
        user = new User({
            username,
            email,
            phoneNumber,
            password,
            dob: new Date(dob), // Convert string date to Date object
            location,
            isOnline: true,
            lastActivity: new Date()
        });

        await user.save();

        res.status(201).json({
            msg: 'User registered successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });

    } catch (err) {
        console.error('Registration error:', err);
        if (err.name === 'ValidationError') {
            return res.status(400).json({ msg: Object.values(err.errors).map(e => e.message).join(', ') });
        }
        res.status(500).json({ msg: 'Server error during registration' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ msg: 'Please enter all fields' });
        }

        // Check for existing user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }

        // Validate password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }

        // Update user status
        user.isOnline = true;
        user.lastActivity = new Date();
        await user.save();
        
        res.json({
            msg: 'Login successful',
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ msg: 'Server error during login' });
    }
});

module.exports = router; 