const mongoose = require("mongoose");

const answerLogsSchema = new mongoose.Schema({
    team_id: { type: String, required: true },
    question_id: { type: mongoose.SchemaTypes.ObjectId, required: true },
    team_name:{ type:String, required:true },
    question_track: { type: Number, required: true },
    question_stage: { type: Number, required: true },
    team_stage: { type: Number, required: true },
    attempted_answer: { type: String, required: true },
  }, 
  { timestamps: true }
);

const AnswerLogs = mongoose.model("AnswerLogs", answerLogsSchema);

module.exports = AnswerLogs ;