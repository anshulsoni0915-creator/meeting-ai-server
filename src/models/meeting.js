import mongoose from "mongoose";

const segmentSchema = new mongoose.Schema({
  speaker: { type: String, default: "Speaker 1" },
  start: { type: Number },
  end: { type: Number },
  text: { type: String },
});

const meetingSchema = new mongoose.Schema(
  {
    title: { type: String, default: "Untitled Meeting" },
    originalFileName: { type: String },
    detectedLanguage: { type: String, default: "Unknown" },
    targetLanguage: { type: String, default: "Original" },
    rawTranscript: { type: String, required: true },
    translatedTranscript: { type: String, default: "" },
    diarizedSegments: [segmentSchema],
    summary: {
      executiveSummary: { type: String, default: "" },
      keyPoints: [{ type: String }],
      actionItems: [
        {
          task: { type: String },
          owner: { type: String, default: "Unassigned" },
        },
      ],
    },
    metrics: {
      audioDurationSec: { type: Number, default: 0 },
      processingTimeMs: { type: Number, default: 0 },
      realTimeFactor: { type: Number, default: 0 },
      wordCount: { type: Number, default: 0 },
      speakerCount: { type: Number, default: 1 },
    },
    accessPin: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Meeting", meetingSchema);
