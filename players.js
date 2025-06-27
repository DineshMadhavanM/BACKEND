const express = require('express');
const router = express.Router();

const Player = require('../models/Player');

// @route   GET api/players
// @desc    Get all players
// @access  Public
router.get('/', async (req, res) => {
    try {
        const players = await Player.find().sort({ name: 1 });
        res.json(players);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/players/:name
// @desc    Get a single player's stats by name
// @access  Public
router.get('/:name', async (req, res) => {
    try {
        const playerName = decodeURIComponent(req.params.name);
        const player = await Player.findOne({ name: playerName });

        if (!player) {
            return res.status(404).json({ msg: 'Player not found' });
        }
        
        // Manually attach virtuals if needed, or ensure they are serialized
        const playerObject = player.toObject({ virtuals: true });
        res.json(playerObject);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router; 