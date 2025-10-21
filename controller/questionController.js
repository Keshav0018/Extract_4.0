const Question = require("../models/questionModel");
const Team = require("../models/teamModel");
const AnswerLogs = require("../models/answerLogsModel");
const mongoose = require("mongoose");

const hasSubmitted = function (q, curTeam) {
  return q.submitted_teams.some((team) => team.team_id === curTeam.team_id);
};

module.exports.getQuestionByTrack = async function (req, res) {
  try {
    if (!req.team) {
      return res.status(401).json({
        status: "fail",
        message: "Unauthorized: Team not found in request",
      });
    }

    const requestedTrack = parseInt(req.params.track_no);
    if (isNaN(requestedTrack) || requestedTrack < 1 || requestedTrack > 4) {
      return res
        .status(400)
        .json({ status: "fail", message: "Invalid track number" });
    }

    if (req.team.track !== requestedTrack && req.team.track !== -1) {
      return res
        .status(403)
        .json({ status: "fail", message: "Access denied: Track mismatch" });
    }

    const questions = await Question.find({ track: requestedTrack })
      .select("-ans") // hide correct answers
      .sort({ stage: 1 })
      .lean();

    if (!questions || questions.length === 0) {
      return res
        .status(404)
        .json({ status: "fail", message: "No question found for this track" });
    }

    const questionStatus = questions.map((q) => {
      console.log(q);

      if (q.stage === req.team.stage)
        return { stage: q.stage, status: "current" };
      if (hasSubmitted(q, req.team))
        return { stage: q.stage, status: "solved" };
      return { stage: q.stage, status: "locked" };
    });

    res.status(200).json({
      status: "success",
      data: {
        track: requestedTrack,
        questions: questionStatus,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching questions:", error.message);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

module.exports.getQuestionAccess = async function (req, res) {
  try {
    // 1️⃣ Ensure team is in request
    if (!req.team) {
      return res.status(401).json({
        status: "fail",
        message: "Unauthorized: Team not found in request",
      });
    }

    const requestedTrack = parseInt(req.params.track_no);
    const requestedStage = parseInt(req.params.stage_no);

    // 2️⃣ Validate track & stage
    if (
      isNaN(requestedTrack) ||
      requestedTrack < 1 ||
      requestedTrack > 4 ||
      isNaN(requestedStage) ||
      requestedStage < 1 ||
      requestedStage > 4
    ) {
      return res
        .status(400)
        .json({ status: "fail", message: "Invalid track or stage number" });
    }

    // 3️⃣ Access control
    if (req.team.track !== requestedTrack && req.team.track !== -1) {
      return res
        .status(403)
        .json({ status: "fail", message: "Access denied: Track mismatch" });
    }
    if (req.team.stage < requestedStage) {
      return res
        .status(403)
        .json({ status: "fail", message: "Access denied: Stage locked" });
    }

    // 4️⃣ Fetch the question (hide the correct answer)
    const question = await Question.findOne({
      track: requestedTrack,
      stage: requestedStage,
    })
      .select("-ans") // never send the correct answer
      .lean();

    if (!question) {
      return res
        .status(404)
        .json({ status: "fail", message: "Question not found" });
    }

    // 5️⃣ Mark discoveredBy atomically
    await Question.updateOne(
      { _id: question._id, discoveredBy: { $ne: req.team.team_id } },
      { $push: { discoveredBy: req.team.team_id } }
    );

    let status = "current";
    if (hasSubmitted(question, req.team)) {
      status = "solved";
    }

    // 6️⃣ Check if team already attempted this question
    const lastAttempt = await AnswerLogs.findOne({
      team_id: req.team.team_id,
      question_id: question._id,
    })
      .sort({ createdAt: -1 }) // latest attempt
      .lean();

    // 7️⃣ Build response
    // Build response for frontend
    const responseData = {
      stage: question.stage,
      ques: question.ques,
      status,
    };

    // If team already attempted, include last attempt for pre-fill
    if (lastAttempt) {
      responseData.lastAttempt = lastAttempt.attempted_answer;
    }

    return res.status(200).json({
      status: "success",
      data: responseData,
    });
  } catch (error) {
    console.error("❌ Error fetching question access:", error.message);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

module.exports.submitAnswer = (io) =>
  async function (req, res) {
    const MAX_RETRIES = 3; // Number of retry attempts for transient conflicts

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const session = await mongoose.startSession();
      session.startTransaction();

      console.log("Received body:", req.body);

      try {
        // 1️⃣ Ensure team is in request
        if (!req.team) {
          await session.abortTransaction();
          session.endSession();
          return res.status(401).json({
            status: "fail",
            message: "Unauthorized: Team not found in request",
          });
        }

        const team = await Team.findOne({ team_id: req.team.team_id }).session(
          session
        );

        // 2️⃣ Validate track & stage from URL
        const requestedTrack = parseInt(req.params.track_no);
        const requestedStage = parseInt(req.params.stage_no);

        if (
          isNaN(requestedTrack) ||
          requestedTrack < 1 ||
          requestedTrack > 4 ||
          isNaN(requestedStage) ||
          requestedStage < 1 ||
          requestedStage > 4
        ) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            status: "fail",
            message: "Invalid track or stage number",
          });
        }

        // 3️⃣ Access control: correct track & stage
        if (team.track !== requestedTrack && team.track !== -1) {
          await session.abortTransaction();
          session.endSession();
          return res.status(403).json({
            status: "fail",
            message: "Track mismatch",
          });
        }

        if (team.stage < requestedStage) {
          await session.abortTransaction();
          session.endSession();
          return res.status(403).json({
            status: "fail",
            message: "Stage locked",
          });
        }

        // 4️⃣ Fetch the question
        const question = await Question.findOne({
          track: requestedTrack,
          stage: requestedStage,
        }).session(session);

        if (!question) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            status: "fail",
            message: "Question not found",
          });
        }

        // 5️⃣ Check if already solved
        if (hasSubmitted(question, team)) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            status: "fail",
            message: "Already solved",
          });
        }

        // 6️⃣ Log attempt
        const { attempted_answer } = req.body;
        const attemptLog = new AnswerLogs({
          team_id: team.team_id,
          team_name: team.team_name,
          question_id: question._id,
          question_track: requestedTrack,
          question_stage: requestedStage,
          team_stage: team.stage,
          attempted_answer,
        });
        await attemptLog.save({ session });

        // 7️⃣ Normalize & check answer
        let normalizedAnswer = attempted_answer.trim().toLowerCase();
        let correctAnswer = question.ans.trim().toLowerCase();

        if (normalizedAnswer !== correctAnswer) {
          // ❌ Wrong answer: commit logs only
          await session.commitTransaction();
          session.endSession();
          return res.status(200).json({
            status: "wrong",
            attempted_answer,
          });
        }

        // ✅ Correct answer: update submitted_teams and team stage
        question.submitted_teams.push({
          team_id: team.team_id,
          timestamp: new Date(),
        });
        await question.save({ session });

        // Assign track if not already
        if (team.track === -1) {
          team.track = requestedTrack;
        }

        team.stage += 1;
        team.points += question.points;
        team.stage_start_time = new Date();
        await team.save({ session });

        // Commit all changes atomically
        await session.commitTransaction();
        session.endSession();

        // 🏆 Emit leaderboard update
        try {
          const topTeams = await Team.find({})
            .sort({ points: -1 })
            .limit(10)
            .select("team_name points stage track");

          io.emit("leaderboardUpdate", topTeams);
          console.log("📢 Leaderboard update emitted");
        } catch (socketError) {
          console.error(
            "⚠️ Failed to emit leaderboard update:",
            socketError.message
          );
        }

        return res.status(200).json({
          status: "correct",
          message: "Answer correct, stage advanced",
        });
      } catch (error) {
        // 🧠 Handle transient transaction conflicts
        if (
          error.errorLabels &&
          error.errorLabels.includes("TransientTransactionError") &&
          attempt < MAX_RETRIES
        ) {
          console.warn(
            `⚠️ Write conflict detected (Attempt ${attempt}) — Retrying...`
          );
          await session.abortTransaction();
          session.endSession();
          continue; // 🔁 Retry the transaction
        }

        await session.abortTransaction();
        session.endSession();

        if (
          error.errorLabels &&
          error.errorLabels.includes("TransientTransactionError")
        ) {
          console.error("❌ Write conflict: too many attempts failed.");
          return res.status(409).json({
            status: "fail",
            message:
              "Too many teams are submitting simultaneously. Please try again in a moment.",
          });
        }

        console.error("❌ Error submitting answer:", error.message);
        return res.status(500).json({
          status: "error",
          message: "Server error, please try again.",
        });
      }
    }
  };

// CRUD OPERATIONS for Questions (Admin use)

// Create a new question
module.exports.createQuestion = async (req, res) => {
  try {
    const { ques, ans, stage, track, points, nextHint } = req.body;

    const newQuestion = await Question.create({
      ques,
      ans,
      stage,
      track,
      points,
      nextHint,
    });

    return res.status(201).json({ status: "success", data: newQuestion });
  } catch (error) {
    console.error("❌ Error creating question:", error.message);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

// Get all questions
module.exports.getAllQuestions = async (req, res) => {
  try {
    const questions = await Question.find().sort({ track: 1, stage: 1 }).lean();
    res
      .status(200)
      .json({ status: "success", results: questions.length, data: questions });
  } catch (error) {
    console.error("❌ Error fetching questions:", error.message);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

// Get a single question by ID
module.exports.getQuestion = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id).lean();
    if (!question)
      return res
        .status(404)
        .json({ status: "fail", message: "Question not found" });

    res.status(200).json({ status: "success", data: question });
  } catch (error) {
    console.error("❌ Error fetching question:", error.message);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

// Update a question
module.exports.updateQuestion = async (req, res) => {
  try {
    const updatedQuestion = await Question.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).lean();

    if (!updatedQuestion)
      return res
        .status(404)
        .json({ status: "fail", message: "Question not found" });

    res.status(200).json({ status: "success", data: updatedQuestion });
  } catch (error) {
    console.error("❌ Error updating question:", error.message);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

// Delete a question
module.exports.deleteQuestion = async (req, res) => {
  try {
    const deleted = await Question.findByIdAndDelete(req.params.id);
    if (!deleted)
      return res
        .status(404)
        .json({ status: "fail", message: "Question not found" });

    res.status(200).json({ status: "success", message: "Question deleted" });
  } catch (error) {
    console.error("❌ Error deleting question:", error.message);
    res.status(500).json({ status: "error", message: "Server error" });
  }
};

// middleware/rateLimiter.js
const rateLimitStore = new Map(); // Stores attempt data in memory

const RATE_LIMIT = 3; // Max 3 submissions
const WINDOW_MS = 60 * 1000; // 1-minute window
const BAN_TIME_MS = 5 * 60 * 1000; // 5-minute ban

module.exports.rateLimiter = function (req, res, next) {
  // You can use req.body.team_id if teams are submitting
  const identifier = req.body.team_id || req.ip;
  const now = Date.now();

  const userData = rateLimitStore.get(identifier) || {
    attempts: 0,
    firstAttempt: now,
    bannedUntil: null,
  };

  // Check if banned
  if (userData.bannedUntil && now < userData.bannedUntil) {
    const remaining = Math.ceil((userData.bannedUntil - now) / 1000);
    return res.status(429).json({
      success: false,
      message: `🚫 Too many attempts. Please wait ${remaining}s before trying again.`,
    });
  }

  // Reset attempts if the window expired
  if (now - userData.firstAttempt > WINDOW_MS) {
    userData.attempts = 0;
    userData.firstAttempt = now;
  }

  userData.attempts += 1;

  // Exceeded rate limit
  if (userData.attempts > RATE_LIMIT) {
    userData.bannedUntil = now + BAN_TIME_MS;
    rateLimitStore.set(identifier, userData);
    return res.status(429).json({
      success: false,
      message: `🚫 Rate limit exceeded. You are banned for 5 minutes.`,
    });
  }

  // Save updated data and continue
  rateLimitStore.set(identifier, userData);
  next();
};

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    // If ban expired + some buffer (10s), remove it
    if (data.bannedUntil && now > data.bannedUntil + 10000) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Example controller for 4tracks game
module.exports.getTrackStatus = async (req, res) => {
  try {
    // Step 1: Check if team present
    if (!req.team) {
      return res
        .status(400)
        .json({ status: "fail", message: "Team not found" });
    }

    const team = req.team; // already attached to request (maybe via middleware)
    const track = team.track; // assuming track field in team model

    // Step 2: If no track assigned yet (-1 means none)
    if (track === -1) {
      console.log("Siuu");
      return res.json({
        status: "success",
        data: {
          track1: "open",
          track2: "open",
          track3: "open",
          track4: "open",
        },
      });
    }

    // Step 3: Based on team track
    let tracksStatus = {
      track1: "closed",
      track2: "closed",
      track3: "closed",
      track4: "closed",
    };

    // Keep only the assigned track open
    tracksStatus[`track${track}`] = "open";

    // Step 4: Return response
    return res.status(200).json({
      status: "success",
      data: tracksStatus,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: "fail", message: "Server error" });
  }
};
