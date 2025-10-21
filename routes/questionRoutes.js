const express = require("express");
const questionController = require("../controller/questionController");
const router = express.Router();

const { io } = require("../app");

router.get("/tracks/:track_no", questionController.getQuestionByTrack);

router
  .route("/access/:track_no/:stage_no")
  .get(questionController.getQuestionAccess) // fetch question
  .post(questionController.rateLimiter, (req, res) =>
    questionController.submitAnswer(req.io)(req, res)
  ); // submit answer

router.get("/tracksStatus", questionController.getTrackStatus);

router
  .route("/")
  .post(questionController.createQuestion) // Create a new question
  .get(questionController.getAllQuestions); // Get all questions

router
  .route("/:id")
  .get(questionController.getQuestion) // Get a single question by ID
  .patch(questionController.updateQuestion) // Update a question by ID
  .delete(questionController.deleteQuestion); // Delete a question by ID

module.exports = router;
