const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};
let currentQuestion = 0;
let isAcceptingAnswers = false;
let questionStartTime = 0;

let gameStarted = false;
let hostSocketId = null;

const questions = [
    { q: "When did Southwest Airlines commence its first flights?", options: ["1967", "1971", "1980", "1995"], ans: 1 },
    { q: "What is the stock ticker symbol for Southwest Airlines?", options: ["SWA", "LUV", "SWAIR", "FLY"], ans: 1 },
    { q: "Which airport is the main operating base and headquarters for Southwest Airlines?", options: ["Dallas/Fort Worth (DFW)", "Houston George Bush (IAH)", "Dallas Love Field (DAL)", "Austin-Bergstrom (AUS)"], ans: 2 },
    { q: "Southwest Airlines is famous for operating primarily one aircraft type. Which one is it?", options: ["Boeing 737", "Airbus A320", "Boeing 757", "Embraer E190"], ans: 0 },
    { q: "How many checked bags fly free on Southwest Airlines?", options: ["None", "One", "Two", "Three"], ans: 2 },
    { q: "What was the original corporate name of Southwest Airlines?", options: ["Texas International Airlines", "Air Southwest Company", "Southern Skies", "Lone Star Airlines"], ans: 1 },
    { q: "Who was the flamboyant co-founder and long-time CEO of Southwest Airlines?", options: ["Herb Kelleher", "Howard Hughes", "Richard Branson", "Gordon Bethune"], ans: 0 },
    { q: "What is the name of Southwest Airlines' frequent flyer program?", options: ["AAdvantage", "SkyMiles", "TrueBlue", "Rapid Rewards"], ans: 3 }
];

io.on('connection', (socket) => {
    
    socket.on('claimHost', () => {
        if (!hostSocketId) {
            hostSocketId = socket.id;
            // Send the questions directly to the Host dashboard
            socket.emit('hostClaimed', { success: true, questions: questions });
        } else {
            socket.emit('hostClaimed', { success: false });
        }
    });

    socket.on('join', (name) => {
        if (gameStarted) {
            socket.emit('joinError', 'The flight has already departed! You cannot join a game in progress.');
            return;
        }
        players[socket.id] = { name: name, score: 0, hasAnswered: false };
        io.emit('updatePlayers', Object.values(players));
        socket.emit('joinSuccess');
    });

    socket.on('startQuestion', () => {
        if (socket.id !== hostSocketId) return; 
        
        gameStarted = true; 
        
        if(currentQuestion < questions.length) {
            isAcceptingAnswers = true;
            questionStartTime = Date.now();
            for(let id in players) players[id].hasAnswered = false;
            
            io.emit('newQuestion', { qIndex: currentQuestion, question: questions[currentQuestion] });
            io.emit('updatePlayers', Object.values(players)); // Reset answers on host dash
        } else {
            let sorted = Object.values(players).sort((a, b) => b.score - a.score);
            io.emit('gameOver', sorted.slice(0, 3)); 
        }
    });

    socket.on('answer', (ansIndex) => {
        let player = players[socket.id];
        if(!player || player.hasAnswered || !isAcceptingAnswers) return;
        
        player.hasAnswered = true;
        let timeTaken = (Date.now() - questionStartTime) / 1000; 
        
        if (ansIndex === questions[currentQuestion].ans) {
            let points = 100; 
            let bonus = 0;
            if (timeTaken < 1) {
                bonus = 600;
            } else {
                bonus = 600 - (Math.floor(timeTaken) * 20);
                if (timeTaken >= 20) bonus = 20; 
                if (bonus < 20) bonus = 20;
            }
            player.score += (points + bonus);
        }
        
        // Update the host dashboard live every time someone answers
        io.emit('updatePlayers', Object.values(players));
    });

    socket.on('endQuestion', () => {
        if (socket.id !== hostSocketId) return; 
        isAcceptingAnswers = false;
        currentQuestion++;
        let sorted = Object.values(players).sort((a, b) => b.score - a.score);
        io.emit('leaderboard', sorted.slice(0, 10)); 
    });

    socket.on('restartGame', () => {
        if (socket.id !== hostSocketId) return; 
        
        gameStarted = false; 
        currentQuestion = 0;
        
        for(let id in players) {
            players[id].score = 0;
            players[id].hasAnswered = false;
        }
        
        io.emit('gameReset'); 
        io.emit('updatePlayers', Object.values(players));
    });

    socket.on('disconnect', () => {
        if (socket.id === hostSocketId) hostSocketId = null; 
        delete players[socket.id];
        io.emit('updatePlayers', Object.values(players));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));