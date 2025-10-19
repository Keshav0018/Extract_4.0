const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema({
  team_id: { type: String, unique: true, required: true },
  team_name:{ type:String,unique:true,required:true },
  password: { type: String, required: true },
  track: { type: Number, default: -1 },
  stage: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  role: { type: String, default: "team" },
  stage_start_time: { type: Date, default: Date.now }
});

const Team = mongoose.model("Team", teamSchema);

module.exports = Team ;