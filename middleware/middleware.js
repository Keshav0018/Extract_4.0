const Team = require("../models/teamModel");

exports.setTestTeam = async function (req, res, next) {
  try {
    // Find a team with track -1 (unassigned) for testing
    const team = await Team.findOne({ team_id: "T004" }).lean();
    if (!team) {
      return res.status(404).json({ error: "No test team found with track 1" });
    }

    // Remove password before attaching
    const { password, ...teamData } = team;

    // Attach to req.team
    req.team = teamData;

    next();
  } catch (error) {
    console.error("Middleware error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
};
