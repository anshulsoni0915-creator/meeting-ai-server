import express from "express";
import upload from "../middleware/upload.js";
import {
  handleMeetingUpload,
  getAllMeetings,
  deleteMeeting,
  renameSpeakers,
  askMeeting,
  updateAccessPolicy,
  exportMeetingPdf,
  exportMeetingDocx,
} from "../controllers/meetingController.js";

const router = express.Router();

router.post("/upload", upload.single("audio"), handleMeetingUpload);
router.get("/", getAllMeetings);
router.delete("/:id", deleteMeeting);
router.patch("/:id/speakers", renameSpeakers);
router.post("/:id/ask", askMeeting);
router.patch("/:id/access", updateAccessPolicy);
router.get("/:id/export/pdf", exportMeetingPdf);
router.get("/:id/export/docx", exportMeetingDocx);

export default router;
