const express = require('express');
const router = express.Router();

const { Match, MatchRequest } = require('../models/Match');
const Player = require('../models/Player');
const User = require('../models/User');

// @route   POST api/matches
// @desc    Save a completed match and update player stats
// @access  Public
router.post('/', async (req, res) => {
    try {
        const matchData = req.body;
        
        // --- Data Validation ---
        if (!matchData.teamA?.name || !matchData.teamB?.name || !matchData.overs) {
            return res.status(400).json({ error: 'Missing required match data' });
        }
        if (!matchData.innings || !Array.isArray(matchData.innings) || matchData.innings.length === 0) {
            return res.status(400).json({ error: 'Invalid innings data' });
        }

        const allPlayerNames = new Set();
        matchData.teamA.xi.forEach(p => allPlayerNames.add(p));
        matchData.teamB.xi.forEach(p => allPlayerNames.add(p));

        const playerUpdatePromises = Array.from(allPlayerNames).map(playerName => {
            const battingStats = matchData.innings.flatMap(i => i.batsmen).find(b => b.name === playerName) || {};
            const bowlingStats = matchData.innings.flatMap(i => i.bowlers).find(b => b.name === playerName) || {};
            
            const isOut = battingStats.status ? !battingStats.status.toLowerCase().includes('not out') : false;
            
            const update = {
                $inc: {
                    'matchesPlayed': 1,
                    'batting.totalRuns': Number(battingStats.runs) || 0,
                    'batting.ballsFaced': Number(battingStats.balls) || 0,
                    'batting.fours': Number(battingStats.fours) || 0,
                    'batting.sixes': Number(battingStats.sixes) || 0,
                    'batting.ducks': (battingStats.runs === 0 && isOut) ? 1 : 0,
                    'bowling.totalWickets': Number(bowlingStats.wickets) || 0,
                    'bowling.runsConceded': Number(bowlingStats.runs) || 0,
                    'bowling.ballsBowled': (Math.floor(Number(bowlingStats.overs) || 0) * 6) + ((Number(bowlingStats.overs) || 0) % 1) * 10,
                    'manOfTheMatchAwards': (matchData.manOfTheMatch?.name === playerName) ? 1 : 0,
                }
            };

            return Player.findOneAndUpdate(
                { name: playerName },
                update,
                { new: true, upsert: true, setDefaultsOnInsert: true }
            );
        });
        
        const updatedPlayers = await Promise.all(playerUpdatePromises);
        const playerIds = updatedPlayers.map(p => p._id);

        const newMatch = new Match({
            teamA: matchData.teamA,
            teamB: matchData.teamB,
            ballType: matchData.ballType,
            overs: matchData.overs,
            result: matchData.result,
            winner: matchData.winner,
            manOfTheMatch: matchData.manOfTheMatch,
            innings: matchData.innings,
            players: playerIds
        });

        const savedMatch = await newMatch.save();

        res.status(201).json({
            message: 'Match saved and player stats updated successfully',
            match: savedMatch,
            players: updatedPlayers
        });

    } catch (err) {
        console.error('Error saving match:', err);
        // Provide more detailed error response
        res.status(500).json({ 
            error: err.message, 
            code: err.code,
            keyValue: err.keyValue 
        });
    }
});

// @route   GET api/matches
// @desc    Get all matches
// @access  Public
router.get('/', async (req, res) => {
    try {
        const matches = await Match.find().sort({ date: -1 });
        res.json(matches);
    } catch (err) {
        console.error('Error in GET /api/matches:', err);
        res.status(500).json({ error: err.message });
    }
});

// @route   GET api/matches/:id
// @desc    Get a single match by ID
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const match = await Match.findById(req.params.id);

        if (!match) {
            return res.status(404).json({ msg: 'Match not found' });
        }

        res.json(match);
    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Match not found' });
        }
        res.status(500).send('Server Error');
    }
});

// New route for match requests
router.post('/request', async (req, res) => {
    try {
        const { userId, matchType, preferredDate, preferredVenue } = req.body;

        // Verify user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Create match request
        const matchRequest = new MatchRequest({
            userId,
            matchType,
            preferredDate,
            preferredVenue
        });

        await matchRequest.save();

        res.status(201).json({
            message: 'Match request created successfully',
            request: matchRequest
        });
    } catch (error) {
        console.error('Error creating match request:', error);
        res.status(500).json({ message: 'Error creating match request', error: error.message });
    }
});

// Get all match requests
router.get('/requests', async (req, res) => {
    try {
        const requests = await MatchRequest.find()
            .populate('userId', 'username email phoneNumber')
            .sort({ requestedAt: -1 });
        res.json(requests);
    } catch (error) {
        console.error('Error fetching match requests:', error);
        res.status(500).json({ message: 'Error fetching match requests', error: error.message });
    }
});

// Update match request status
router.patch('/request/:requestId', async (req, res) => {
    try {
        const { status } = req.body;
        const request = await MatchRequest.findByIdAndUpdate(
            req.params.requestId,
            { status },
            { new: true }
        ).populate('userId', 'username email phoneNumber');

        if (!request) {
            return res.status(404).json({ message: 'Match request not found' });
        }

        res.json(request);
    } catch (error) {
        console.error('Error updating match request:', error);
        res.status(500).json({ message: 'Error updating match request', error: error.message });
    }
});

module.exports = router;