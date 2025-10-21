const Team = require("../models/teamModel");

exports.setTestTeam = async function (req, res, next) {
  try {
    // Find a team with track -1 (unassigned) for testing
    const team = await Team.findOne({ team_id: "T00" }).lean();
    if (!team) {
      return res
        .status(404)
        .json({ status: "fail", error: "No test team found " });
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
