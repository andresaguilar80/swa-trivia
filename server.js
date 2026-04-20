const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- CONFIGURATION ---
const ADMIN_ID = "andresaguilar80";
const QUESTIONS = [
    { q: "When did Southwest Airlines commence its first flights?", options: ["1967", "1971", "1980", "1995"], ans: 1 },
    { q: "What is the stock ticker symbol for Southwest Airlines?", options: ["SWA", "LUV", "SWAIR", "FLY"], ans: 1 },
    { q: "Which airport is the main operating base and headquarters for Southwest Airlines?", options: ["Dallas/Fort Worth (DFW)", "Houston George Bush (IAH)", "Dallas Love Field (DAL)", "Austin-Bergstrom (AUS)"], ans: 2 },
    { q: "Southwest Airlines is famous for operating primarily one aircraft type. Which one is it?", options: ["Boeing 737", "Airbus A320", "Boeing 757", "Embraer E190"], ans: 0 },
    { q: "How many checked bags fly free on Southwest Airlines?", options: ["None", "One", "Two", "Three"], ans: 2 },
    { q: "What was the original corporate name of Southwest Airlines?", options: ["Texas International Airlines", "Air Southwest Company", "Southern Skies", "Lone Star Airlines"], ans: 1 },
    { q: "Who was the flamboyant co-founder and long-time CEO of Southwest Airlines?", options: ["Herb Kelleher", "Howard Hughes", "Richard Branson", "Gordon Bethune"], ans: 0 },
    { q: "What is the name of Southwest Airlines' frequent flyer program?", options: ["AAdvantage", "SkyMiles", "TrueBlue", "Rapid Rewards"], ans: 3 }
];

class TriviaGame {
    constructor() {
        this.state = 'LOBBY'; 
        this.players = new Map(); 
        this.currentQuestionIndex = 0;
        this.hostSocketId = null;
        this.questionStartTime = 0;
    }

    addOrUpdatePlayer(uuid, name, socketId) {
        if (!this.players.has(uuid)) {
            if (this.state !== 'LOBBY') return false; 
            this.players.set(uuid, { name, score: 0, hasAnswered: false, socketId, lastAnswer: null });
        } else {
            let p = this.players.get(uuid);
            p.socketId = socketId;
        }
        return true;
    }

    calculateScore(timeTakenSeconds, isLastQuestion) {
        let points = 100;
        let bonus = timeTakenSeconds < 1 ? 600 : Math.max(20, 600 - (Math.floor(timeTakenSeconds) * 20));
        let total = points + bonus;
        return isLastQuestion ? total * 2 : total;
    }

    getTopPlayers(limit = 10) {
        return Array.from(this.players.values())
            .sort((a, b) => b.score - a.score)
            .map(p => ({ name: p.name, score: p.score, hasAnswered: p.hasAnswered, lastAnswer: p.lastAnswer }))
            .slice(0, limit);
    }

    reset() {
        this.state = 'LOBBY';
        this.currentQuestionIndex = 0;
        for (let [_, player] of this.players) {
            player.score = 0;
            player.hasAnswered = false;
            player.lastAnswer = null;
        }
    }
}

const game = new TriviaGame();
let questionTimeout = null; 

// EL SERVIDOR TOMA EL CONTROL DEL CIERRE DE PREGUNTAS
function handleQuestionEnd() {
    if (game.state !== 'QUESTION') return;
    const correctText = QUESTIONS[game.currentQuestionIndex].options[QUESTIONS[game.currentQuestionIndex].ans];
    game.currentQuestionIndex++;

    if (game.currentQuestionIndex < QUESTIONS.length) {
        game.state = 'LEADERBOARD';
        io.emit('leaderboard', { top10: game.getTopPlayers(10), correctAnswer: correctText });
    } else {
        game.state = 'PODIUM';
        io.emit('gameOver', game.getTopPlayers(3));
    }
}

// VALIDADOR: SI TODOS RESPONDEN, CORTAR TIEMPO
function checkAllAnswered() {
    if (game.state !== 'QUESTION') return;
    let allAnswered = true;
    let activePlayers = 0;
    
    for (let [_, p] of game.players) {
        if (p.socketId) { // Solo cuenta jugadores conectados
            activePlayers++;
            if (!p.hasAnswered) {
                allAnswered = false;
                break;
            }
        }
    }
    
    if (activePlayers > 0 && allAnswered) {
        clearTimeout(questionTimeout);
        handleQuestionEnd();
    }
}

io.on('connection', (socket) => {
    socket.emit('hostStatus', !!game.hostSocketId);

    socket.on('claimHost', (adminName) => {
        if (adminName !== ADMIN_ID) {
            return socket.emit('hostClaimed', { success: false, message: "INVALID CREDENTIALS." });
        }
        // Asignación forzosa: Permite reconectar al Host si recarga la página
        game.hostSocketId = socket.id;
        socket.emit('hostClaimed', { success: true, questions: QUESTIONS });
        io.emit('hostStatus', true); 
    });

    socket.on('join', ({ name, uuid }) => {
        const joined = game.addOrUpdatePlayer(uuid, name, socket.id);
        if (!joined) {
            return socket.emit('joinError', 'The flight has already departed!');
        }
        io.emit('updatePlayers', game.getTopPlayers(100)); 
        socket.emit('joinSuccess');
    });

    socket.on('startQuestion', () => {
        if (socket.id !== game.hostSocketId || game.state === 'QUESTION') return;
        
        game.state = 'QUESTION';
        game.questionStartTime = Date.now();
        
        for (let [_, p] of game.players) {
            p.hasAnswered = false;
            p.lastAnswer = null; 
        }

        const isLast = game.currentQuestionIndex === (QUESTIONS.length - 1);
        io.emit('newQuestion', { qIndex: game.currentQuestionIndex, question: QUESTIONS[game.currentQuestionIndex], isLast });
        io.emit('updatePlayers', game.getTopPlayers(100)); 

        // CRONÓMETRO INQUEBRANTABLE DEL SERVIDOR (20 Segundos exactos)
        clearTimeout(questionTimeout);
        questionTimeout = setTimeout(() => {
            handleQuestionEnd();
        }, 20000); 
    });

    socket.on('answer', ({ uuid, ansIndex }) => {
        if (game.state !== 'QUESTION') return;
        
        const player = game.players.get(uuid);
        if (!player || player.hasAnswered) return;

        player.hasAnswered = true;
        player.lastAnswer = QUESTIONS[game.currentQuestionIndex].options[ansIndex];
        
        const timeTaken = (Date.now() - game.questionStartTime) / 1000;

        if (ansIndex === QUESTIONS[game.currentQuestionIndex].ans) {
            player.score += game.calculateScore(timeTaken, game.currentQuestionIndex === (QUESTIONS.length - 1));
        }
        
        io.emit('updatePlayers', game.getTopPlayers(100));
        checkAllAnswered(); // Verificar si ya todos terminaron
    });

    socket.on('endQuestion', () => {
        if (socket.id !== game.hostSocketId) return;
        clearTimeout(questionTimeout); 
        handleQuestionEnd();
    });

    socket.on('restartGame', () => {
        if (socket.id !== game.hostSocketId) return;
        clearTimeout(questionTimeout);
        game.reset();
        io.emit('gameReset');
        io.emit('updatePlayers', game.getTopPlayers(100));
    });

    socket.on('disconnect', () => {
        if (game.players) {
            for (let [uuid, p] of game.players) {
                if (p.socketId === socket.id) {
                    p.socketId = null; // Marca al jugador offline sin borrar su puntaje
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Production Server running on port ${PORT}`));