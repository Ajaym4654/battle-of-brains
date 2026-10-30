
import { getStore } from "@netlify/blobs";

const store = getStore("battle-of-brains-rooms");
const MAX_PLAYERS = 8;
const QUESTION_TIME = 15_000;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const QUESTIONS = [
  {question:"What is the capital of Australia?",options:["Sydney","Melbourne","Canberra","Perth"],correctIndex:2},
  {question:"Which planet is known as the Red Planet?",options:["Venus","Mars","Jupiter","Mercury"],correctIndex:1},
  {question:"How many sides does a hexagon have?",options:["Five","Six","Seven","Eight"],correctIndex:1},
  {question:"Who wrote Romeo and Juliet?",options:["Charles Dickens","William Shakespeare","Jane Austen","Mark Twain"],correctIndex:1},
  {question:"What is the largest ocean on Earth?",options:["Atlantic","Indian","Arctic","Pacific"],correctIndex:3},
  {question:"Which gas do plants absorb from the atmosphere?",options:["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"],correctIndex:2},
  {question:"What is the chemical symbol for gold?",options:["Ag","Au","Gd","Go"],correctIndex:1},
  {question:"How many players are on a soccer team on the field?",options:["9","10","11","12"],correctIndex:2},
  {question:"Which country hosted the 2016 Summer Olympics?",options:["China","Brazil","Japan","Greece"],correctIndex:1},
  {question:"Which instrument has keys, pedals and strings?",options:["Violin","Flute","Piano","Trumpet"],correctIndex:2},
  {question:"What does CPU stand for?",options:["Central Processing Unit","Computer Power Utility","Core Program Unit","Central Performance User"],correctIndex:0},
  {question:"Which language is primarily used to style web pages?",options:["HTML","CSS","SQL","Python"],correctIndex:1},
  {question:"What is the largest mammal in the world?",options:["African elephant","Blue whale","Giraffe","Hippopotamus"],correctIndex:1},
  {question:"Which is the smallest prime number?",options:["0","1","2","3"],correctIndex:2},
  {question:"How many continents are there?",options:["Five","Six","Seven","Eight"],correctIndex:2}
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 18);
}

function validPlayerId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 100;
}

function createCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function publicRoom(room, playerId) {
  const question = room.phase === "question"
    ? room.questions[room.questionIndex]
    : null;

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    categoryName: "Mixed Challenge",
    round: room.round,
    questionIndex: room.questionIndex,
    questionEndsAt: room.questionEndsAt,
    currentQuestion: question
      ? {
          question: question.question,
          options: question.options
        }
      : null,
    answersCount: Object.keys(room.answers || {}).length,
    myAnswer: Object.prototype.hasOwnProperty.call(room.answers || {}, playerId)
      ? room.answers[playerId].answer
      : null,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      score: player.score,
      correct: player.correct,
      ready: player.ready
    }))
  };
}

async function saveRoom(room) {
  room.updatedAt = Date.now();
  await store.setJSON(room.code, room);
}

async function getRoom(code) {
  if (!/^[A-Z0-9]{6}$/.test(code || "")) {
    throw new Error("Please enter a valid 6-character room code.");
  }

  const room = await store.get(code, { type: "json" });

  if (!room) {
    throw new Error("Room not found. Please check the code or create a new room.");
  }

  return room;
}

function findPlayer(room, playerId) {
  return room.players.find(player => player.id === playerId);
}

function requirePlayer(room, playerId) {
  const player = findPlayer(room, playerId);
  if (!player) throw new Error("You are not in this room. Please join again.");
  return player;
}

function requireHost(room, playerId) {
  requirePlayer(room, playerId);
  if (room.hostId !== playerId) {
    throw new Error("Only the room host can perform this action.");
  }
}

function startQuestion(room) {
  room.phase = "question";
  room.answers = {};
  room.questionEndsAt = Date.now() + QUESTION_TIME;
}

function advanceQuestion(room) {
  if (room.phase !== "question") return;

  if (room.questionIndex === 14) {
    room.phase = "finished";
    room.questionEndsAt = null;
    return;
  }

  if ((room.questionIndex + 1) % 5 === 0) {
    room.phase = "roundResults";
    room.questionEndsAt = null;
    return;
  }

  room.questionIndex += 1;
  room.round = Math.floor(room.questionIndex / 5) + 1;
  startQuestion(room);
}

async function settleExpired(room) {
  if (
    room.phase === "question" &&
    room.questionEndsAt &&
    Date.now() >= room.questionEndsAt
  ) {
    advanceQuestion(room);
    await saveRoom(room);
  }
}

async function handleAction(body) {
  const action = body.action;
  const playerId = body.playerId;

  if (!validPlayerId(playerId)) {
    return json({ error: "Invalid player session. Refresh the page and try again." }, 400);
  }

  if (action === "create") {
    const name = cleanName(body.name);
    if (!name) return json({ error: "Please enter your display name." }, 400);

    let code;
    let existing;

    for (let attempt = 0; attempt < 10; attempt++) {
      code = createCode();
      existing = await store.get(code, { type: "json" });
      if (!existing) break;
    }

    if (existing) {
      return json({ error: "Could not create a room. Please try again." }, 503);
    }

    const room = {
      code,
      phase: "lobby",
      hostId: playerId,
      round: 1,
      questionIndex: 0,
      questionEndsAt: null,
      questions: QUESTIONS,
      answers: {},
      players: [{
        id: playerId,
        name,
        score: 0,
        correct: 0,
        ready: true
      }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await saveRoom(room);
    return json({ room: publicRoom(room, playerId) });
  }

  const code = String(body.roomCode || body.code || "").trim().toUpperCase();
  const room = await getRoom(code);

  await settleExpired(room);

  if (action === "join") {
    const name = cleanName(body.name);
    if (!name) return json({ error: "Please enter your display name." }, 400);

    const existingPlayer = findPlayer(room, playerId);
    if (existingPlayer) {
      return json({ room: publicRoom(room, playerId) });
    }

    if (room.phase !== "lobby") {
      return json({ error: "This game has already started. Join another room." }, 409);
    }

    if (room.players.length >= MAX_PLAYERS) {
      return json({ error: "This room is full. Maximum 8 players allowed." }, 409);
    }

    room.players.push({
      id: playerId,
      name,
      score: 0,
      correct: 0,
      ready: false
    });

    await saveRoom(room);
    return json({ room: publicRoom(room, playerId) });
  }

  if (action === "state") {
    requirePlayer(room, playerId);
    return json({ room: publicRoom(room, playerId) });
  }

  if (action === "ready") {
    requirePlayer(room, playerId);

    if (room.phase !== "lobby") {
      return json({ error: "The game has already started." }, 409);
    }

    if (playerId === room.hostId) {
      return json({ room: publicRoom(room, playerId) });
    }

    const player = findPlayer(room, playerId);
    player.ready = Boolean(body.ready);

    await saveRoom(room);
    return json({ room: publicRoom(room, playerId) });
  }

  if (action === "start") {
    requireHost(room, playerId);

    if (room.phase !== "lobby") {
      return json({ error: "This game has already started." }, 409);
    }

    if (room.players.length < 2) {
      return json({ error: "At least 2 players are needed to start." }, 400);
    }

    if (!room.players.every(player => player.ready)) {
      return json({ error: "Wait until all players are ready." }, 400);
    }

    room.round = 1;
    room.questionIndex = 0;
    room.answers = {};
    startQuestion(room);

    await saveRoom(room);
    return json({ room: publicRoom(room, playerId) });
  }

  if (action === "answer") {
    requirePlayer(room, playerId);

    if (room.phase !== "question") {
      return json({ error: "This question is no longer active." }, 409);
    }

    if (Date.now() >= room.questionEndsAt) {
      advanceQuestion(room);
      await saveRoom(room);
      return json({ room: publicRoom(room, playerId) });
    }

    if (Object.prototype.hasOwnProperty.call(room.answers, playerId)) {
      return json({ error: "You have already answered this question." }, 409);
    }

    const answer = Number(body.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) {
      return json({ error: "Invalid answer selection." }, 400);
    }

    const question = room.questions[room.questionIndex];
    const correct = answer === question.correctIndex;
    let points = 0;

    if (correct) {
      const remaining = Math.max(0, room.questionEndsAt - Date.now());
      const speedBonus = Math.floor(50 * remaining / QUESTION_TIME);
      points = 100 + speedBonus;

      const player = findPlayer(room, playerId);
      player.score += points;
      player.correct += 1;
    }

    room.answers[playerId] = {
      answer,
      correct,
      points,
      answeredAt: Date.now()
    };

    if (room.players.every(player =>
      Object.prototype.hasOwnProperty.call(room.answers, player.id)
    )) {
      advanceQuestion(room);
    }

    await saveRoom(room);
    return json({ room: publicRoom(room, playerId) });
  }

  if (action === "next") {
    requireHost(room, playerId);

    if (room.phase !== "roundResults") {
      return json({ error: "There are no round results to advance from." }, 409);
    }

    room.questionIndex += 1;
    room.round = Math.floor(room.questionIndex / 5) + 1;
    startQuestion(room);

    await saveRoom(room);
    return json({ room: publicRoom(room, playerId) });
  }

  if (action === "leave") {
    requirePlayer(room, playerId);

    room.players = room.players.filter(player => player.id !== playerId);
    delete room.answers[playerId];

    if (room.players.length === 0) {
      await store.delete(room.code);
      return json({ left: true });
    }

    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
      room.players[0].ready = true;
    }

    if (room.phase === "question" &&
        room.players.every(player =>
          Object.prototype.hasOwnProperty.call(room.answers, player.id)
        )) {
      advanceQuestion(room);
    }

    await saveRoom(room);
    return json({ left: true, room: publicRoom(room, room.players[0].id) });
  }

  if (action === "rematch") {
    requireHost(room, playerId);

    if (room.phase !== "finished") {
      return json({ error: "Finish the current game before starting a rematch." }, 409);
    }

    room.phase = "lobby";
    room.round = 1;
    room.questionIndex = 0;
    room.questionEndsAt = null;
    room.answers = {};

    room.players.forEach(player => {
      player.score = 0;
      player.correct = 0;
      player.ready = player.id === room.hostId;
    });

    await saveRoom(room);
    return json({ room: publicRoom(room, playerId) });
  }

  return json({ error: "Unknown game action." }, 400);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    const body = await request.json();
    return await handleAction(body);
  } catch (error) {
    console.error("Battle of Brains function error:", error);
    return json({
      error: error?.message || "Unexpected server error."
    }, 400);
  }
}
