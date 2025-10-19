const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  ques: { type: String, required: true },
  ans: { type: String, required: true },
  stage: { type: Number, required: true },
  track: { type: Number, required: true },
  submitted_teams: [
    {
      team_id: String,
      timestamp: Date,
    },
  ],
  discoveredBy: { type: [String], default: [] },
  points: { type: Number, required: true },
  nextHint: { type: String, required: true },
});

const Question = mongoose.model("Question", questionSchema);

module.exports = Question;
