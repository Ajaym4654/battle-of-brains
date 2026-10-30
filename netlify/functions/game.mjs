
import { getStore } from "@netlify/blobs";

const store = getStore("battle-of-brains-rooms");
const LIMIT = 8;
const TIME = 15000;

const QUESTIONS = [
  ["Which planet is known as the Red Planet?", ["Venus","Mars","Jupiter","Saturn"], 1],
  ["What is the largest ocean on Earth?", ["Atlantic","Indian","Arctic","Pacific"], 3],
  ["How many sides does a hexagon have?", ["5","6","7","8"], 1],
  ["Who wrote Romeo and Juliet?", ["Charles Dickens","William Shakespeare","Jane Austen","Mark Twain"], 1],
  ["What is the chemical symbol for gold?", ["Ag","Go","Au","Gd"], 2],
  ["Which animal is the largest mammal?", ["Elephant","Blue whale","Giraffe","Shark"], 1],
  ["What is the capital of Japan?", ["Seoul","Beijing","Tokyo","Bangkok"], 2],
  ["How many players are on a soccer team on the field?", ["9","10","11","12"], 2],
  ["Which gas do plants absorb?", ["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"], 2],
  ["Who painted the Mona Lisa?", ["Van Gogh","Picasso","Leonardo da Vinci","Michelangelo"], 2],
  ["What does CPU stand for?", ["Central Processing Unit","Computer Personal Unit","Central Program Utility","Core Processing User"], 0],
  ["Which is the smallest prime number?", ["0","1","2","3"], 2],
  ["Which country is famous for the Eiffel Tower?", ["Italy","France","Spain","Germany"], 1],
  ["How many colors are in a rainbow?", ["5","6","7","8"], 2],
  ["Which instrument has keys, pedals and strings?", ["Guitar","Violin","Piano","Flute"], 2]
].map((q) => ({
  question: q[0],
  options: q[1],
  correctIndex: q[2]
}));

const CATEGORIES = {
  mixed: "Mixed Challenge",
  general: "General Knowledge",
  science: "Science",
  sports: "Sports",
  movies: "Movies & Entertainment",
  technology: "Technology",
  geography: "Geography"
};

const json = (data, status = 200) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  },
  body: JSON.stringify(data)
});

const fail = (message, status = 400) =>
  json({ error: message }, status);

const code = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

async function loadRoom(code) {
  if (!code) return null;
  return await store.get(code, { type: "json" });
}

async function saveRoom(room) {
  await store.setJSON(room.code, room);
}

function cleanPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    ready: p.ready,
    score: p.score,
    correct: p.correct
  };
}

function publicRoom(room, playerId) {
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const current = room.questions[room.questionIndex];

  return {
    room: {
      code: room.code,
      phase: room.phase,
      category: room.category,
      categoryName: CATEGORIES[room.category] || "Mixed Challenge",
      hostId: room.hostId,
      round: room.round,
      questionIndex: room.questionIndex,
      questionEndsAt: room.questionEndsAt,
      players: sorted.map(cleanPlayer),
      currentQuestion:
        room.phase === "question" && current
          ? {
              question: current.question,
              options: current.options
            }
          : null,
      myAnswer: room.answers?.[playerId]?.answer ?? null,
      answersCount: Object.keys(room.answers || {}).length
    }
  };
}

function scoreAnswers(room) {
  for (const player of room.players) {
    const answer = room.answers[player.id];
    const q = room.questions[room.questionIndex];

    if (answer && answer.answer === q.correctIndex) {
      player.score += 100;
      player.correct += 1;

      if (answer.elapsed <= 5000) player.score += 50;
      else if (answer.elapsed <= 10000) player.score += 25;
    }
  }
}

function advanceQuestion(room) {
  scoreAnswers(room);
  room.answers = {};

  if (room.questionIndex === 4 ||
      room.questionIndex === 9 ||
      room.questionIndex === 14) {
    room.phase = room.questionIndex === 14
      ? "finished"
      : "roundResults";
    return;
  }

  room.questionIndex += 1;
  room.questionEndsAt = Date.now() + TIME;
}

async function settleExpired(room) {
  if (
    room.phase === "question" &&
    Date.now() >= room.questionEndsAt
  ) {
    advanceQuestion(room);
    await saveRoom(room);
  }
}

export default async (request) => {
  if (request.method !== "POST") {
    return fail("Use POST requests.", 405);
  }

  try {
    const body = JSON.parse(request.body || "{}");
    const { action, playerId, name } = body;
    let roomCode = body.roomCode || body.code;

    if (!action || !playerId) {
      return fail("Missing action or player ID.");
    }

    if (action === "create") {
      if (!name?.trim()) return fail("Enter your name.");
      if (!Object.hasOwn(CATEGORIES, body.category)) {
        return fail("Invalid category.");
      }

      let room;
      for (let i = 0; i < 10; i++) {
        const candidate = code();
        if (!(await loadRoom(candidate))) {
          room = {
            code: candidate,
            hostId: playerId,
            category: body.category,
            phase: "lobby",
            round: 1,
            questionIndex: 0,
            questions: [...QUESTIONS],
            questionEndsAt: 0,
            answers: {},
            players: [{
              id: playerId,
              name: name.trim().slice(0, 18),
              ready: true,
              score: 0,
              correct: 0
            }]
          };
          break;
        }
      }

      if (!room) return fail("Could not create a room. Try again.", 500);

      await saveRoom(room);
      return json(publicRoom(room, playerId));
    }

    if (action === "join") {
      roomCode = String(roomCode || "").toUpperCase();
    }

    const room = await loadRoom(roomCode);
    if (!room) return fail("Room not found or expired.");

    await settleExpired(room);

    const player = room.players.find(p => p.id === playerId);

    if (action === "join") {
      if (!name?.trim()) return fail("Enter your name.");
      if (room.phase !== "lobby") return fail("Game already started.");
      if (!player && room.players.length >= LIMIT) {
        return fail("Room is full.");
      }

      if (!player) {
        room.players.push({
          id: playerId,
          name: name.trim().slice(0, 18),
          ready: false,
          score: 0,
          correct: 0
        });
      }

      await saveRoom(room);
      return json(publicRoom(room, playerId));
    }

    if (!player) return fail("You are not in this room.");

    if (action === "state") {
      return json(publicRoom(room, playerId));
    }

    if (action === "ready") {
      if (room.phase !== "lobby") return fail("Lobby is closed.");
      if (player.id === room.hostId) return fail("Host is already ready.");
      player.ready = Boolean(body.ready);
    }

    else if (action === "start") {
      if (playerId !== room.hostId) return fail("Only the host can start.");
      if (room.players.length < 2) return fail("At least 2 players are required.");
      if (!room.players.every(p => p.ready)) {
        return fail("Everyone must be ready.");
      }

      room.phase = "question";
      room.questionIndex = 0;
      room.round = 1;
      room.answers = {};
      room.questionEndsAt = Date.now() + TIME;
    }

    else if (action === "answer") {
      if (room.phase !== "question") return fail("Question is not active.");
      if (!Number.isInteger(body.answer) ||
          body.answer < 0 || body.answer > 3) {
        return fail("Invalid answer.");
      }
      if (room.answers[playerId]) return fail("You already answered.");

      room.answers[playerId] = {
        answer: body.answer,
        elapsed: Math.max(0, TIME - (room.questionEndsAt - Date.now()))
      };

      if (Object.keys(room.answers).length >= room.players.length) {
        advanceQuestion(room);
      }
    }

    else if (action === "next") {
      if (playerId !== room.hostId) return fail("Only the host can continue.");
      if (room.phase !== "roundResults") return fail("Round is not complete.");

      room.round += 1;
      room.questionIndex = (room.round - 1) * 5;
      room.answers = {};
      room.phase = "question";
      room.questionEndsAt = Date.now() + TIME;
    }

    else if (action === "leave") {
      room.players = room.players.filter(p => p.id !== playerId);
      delete room.answers[playerId];

      if (!room.players.length) {
        await store.delete(room.code);
        return json({ ok: true });
      }

      if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
        room.players[0].ready = true;
      }

      if (room.phase === "question" &&
          Object.keys(room.answers).length >= room.players.length) {
        advanceQuestion(room);
      }
    }

    else if (action === "rematch") {
      if (playerId !== room.hostId) return fail("Only the host can rematch.");

      room.phase = "lobby";
      room.round = 1;
      room.questionIndex = 0;
      room.answers = {};
      room.questionEndsAt = 0;

      for (const p of room.players) {
        p.score = 0;
        p.correct = 0;
        p.ready = p.id === room.hostId;
      }
    }

    else {
      return fail("Unknown action.");
    }

    await saveRoom(room);
    return json(publicRoom(room, playerId));

  } catch (error) {
    console.error("Game function error:", error);
    return fail("Game server error. Check Netlify function logs.", 500);
  }
};
