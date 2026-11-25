import { processMeetingAudio, answerMeetingQuestion } from "../services/transcriptionService.js";
import Meeting from "../models/Meeting.js";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import fs from "fs";

export const handleMeetingUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio or video file provided" });
    }

    const targetLanguage = req.body.targetLanguage || "Original";
    const accessPin = (req.body.accessPin || "").trim();

    const result = await processMeetingAudio(req.file.path, targetLanguage);
    fs.unlinkSync(req.file.path);

    const savedMeeting = await Meeting.create({
      title: result.title,
      originalFileName: req.file.originalname,
      detectedLanguage: result.detectedLanguage,
      targetLanguage,
      rawTranscript: result.rawTranscript,
      translatedTranscript: result.translatedTranscript,
      diarizedSegments: result.diarizedSegments,
      summary: result.summary,
      metrics: result.metrics,
      accessPin,
    });

    res.json({
      success: true,
      message: "Meeting processed successfully",
      meeting: savedMeeting,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
};

export const getAllMeetings = async (req, res) => {
  try {
    const meetings = await Meeting.find().sort({ createdAt: -1 });
    res.json({ success: true, meetings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteMeeting = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });

    if (meeting.accessPin && req.headers["x-access-pin"] !== meeting.accessPin) {
      return res.status(403).json({ error: "Invalid Access PIN for this protected meeting." });
    }

    await Meeting.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const renameSpeakers = async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) {
      return res.status(400).json({ error: "Both oldName and newName are required" });
    }

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });

    if (meeting.accessPin && req.headers["x-access-pin"] !== meeting.accessPin) {
      return res.status(403).json({ error: "Invalid Access PIN to edit this meeting." });
    }

    meeting.diarizedSegments = meeting.diarizedSegments.map((seg) => ({
      ...seg.toObject(),
      speaker: seg.speaker === oldName ? newName.trim() : seg.speaker,
    }));

    if (meeting.summary?.actionItems) {
      meeting.summary.actionItems = meeting.summary.actionItems.map((item) => ({
        ...item.toObject(),
        owner: item.owner === oldName ? newName.trim() : item.owner,
      }));
    }

    await meeting.save();
    res.json({ success: true, meeting });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const askMeeting = async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question is required" });

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });

    const answer = await answerMeetingQuestion(meeting, question);
    res.json({ success: true, answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateAccessPolicy = async (req, res) => {
  try {
    const { accessPin } = req.body;
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });

    if (meeting.accessPin && req.headers["x-access-pin"] !== meeting.accessPin) {
      return res.status(403).json({ error: "Enter current PIN before changing access policy." });
    }

    meeting.accessPin = (accessPin || "").trim();
    await meeting.save();
    res.json({ success: true, meeting });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const exportMeetingPdf = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });

    const doc = new PDFDocument({ margin: 50 });
    const safeFilename = (meeting.title || "meeting-report").replace(/[^a-z0-9]/gi, "_");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).text(meeting.title || "Meeting Summary", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555555").text(
      `File: ${meeting.originalFileName} | Detected: ${meeting.detectedLanguage} | Output: ${meeting.targetLanguage}`
    );
    if (meeting.metrics?.processingTimeMs) {
      doc.text(
        `Duration: ${meeting.metrics.audioDurationSec}s | Processing Time: ${(meeting.metrics.processingTimeMs / 1000).toFixed(2)}s | RTF: ${meeting.metrics.realTimeFactor}x | Words: ${meeting.metrics.wordCount}`
      );
    }
    doc.fillColor("#000000").moveDown();

    doc.fontSize(14).text("Executive Summary");
    doc.fontSize(11).text(meeting.summary?.executiveSummary || "N/A");
    doc.moveDown();

    doc.fontSize(14).text("Key Discussion Points");
    (meeting.summary?.keyPoints || []).forEach((pt) => {
      doc.fontSize(11).text(`• ${pt}`);
    });
    doc.moveDown();

    doc.fontSize(14).text("Action Items");
    (meeting.summary?.actionItems || []).forEach((item) => {
      doc.fontSize(11).text(`• [${item.owner}] ${item.task}`);
    });
    doc.moveDown();

    doc.fontSize(14).text("Speaker Diarization");
    (meeting.diarizedSegments || []).forEach((seg) => {
      doc.fontSize(10).text(`${seg.speaker} (${seg.start}s - ${seg.end}s): ${seg.text}`);
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const exportMeetingDocx = async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });

    const children = [
      new Paragraph({ text: meeting.title || "Meeting Summary", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new TextRun({
            text: `File: ${meeting.originalFileName} | Detected: ${meeting.detectedLanguage} | Output: ${meeting.targetLanguage}`,
            italics: true,
          }),
        ],
      }),
      new Paragraph({ text: "Executive Summary", heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: meeting.summary?.executiveSummary || "N/A" }),
      new Paragraph({ text: "Key Discussion Points", heading: HeadingLevel.HEADING_2 }),
      ...(meeting.summary?.keyPoints || []).map(
        (pt) => new Paragraph({ text: pt, bullet: { level: 0 } })
      ),
      new Paragraph({ text: "Action Items", heading: HeadingLevel.HEADING_2 }),
      ...(meeting.summary?.actionItems || []).map(
        (item) => new Paragraph({ text: `[${item.owner}] ${item.task}`, bullet: { level: 0 } })
      ),
      new Paragraph({ text: "Speaker Diarization", heading: HeadingLevel.HEADING_2 }),
      ...(meeting.diarizedSegments || []).map(
        (seg) => new Paragraph({ text: `${seg.speaker} (${seg.start}s - ${seg.end}s): ${seg.text}` })
      ),
    ];

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    const safeFilename = (meeting.title || "meeting-report").replace(/[^a-z0-9]/gi, "_");

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}.docx"`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
