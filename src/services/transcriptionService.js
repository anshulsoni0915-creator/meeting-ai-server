import OpenAI from "openai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const CANDIDATE_MODELS = ["llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];

const extractAudioFromVideo = (inputPath) =>
  new Promise((resolve, reject) => {
    const outPath = `${inputPath}.extracted.mp3`;
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .save(outPath)
      .on("end", () => resolve(outPath))
      .on("error", (err) => reject(err));
  });

export const processMeetingAudio = async (filePath, targetLanguage = "Original") => {
  const startTime = Date.now();
  let fileToTranscribe = filePath;
  let tempExtractedFile = null;

  try {
    const ext = path.extname(filePath).toLowerCase();
    const isVideo = [".mp4", ".webm", ".mkv", ".mov", ".avi", ".mpeg"].includes(ext);

    if (isVideo) {
      tempExtractedFile = await extractAudioFromVideo(filePath);
      fileToTranscribe = tempExtractedFile;
    }

    const whisperResponse = await groq.audio.transcriptions.create({
      file: fs.createReadStream(fileToTranscribe),
      model: "whisper-large-v3",
      response_format: "verbose_json",
    });

    const rawTranscript = whisperResponse.text || "";
    const detectedLanguage = whisperResponse.language || "unknown";
    const audioDurationSec = Number((whisperResponse.duration || 0).toFixed(2));
    const rawSegments = (whisperResponse.segments || []).map((seg) => ({
      start: Number(seg.start.toFixed(1)),
      end: Number(seg.end.toFixed(1)),
      text: seg.text.trim(),
    }));

    const analysisLanguage =
      targetLanguage && targetLanguage !== "Original"
        ? targetLanguage
        : detectedLanguage;

    const systemPrompt = `You are an expert AI Meeting Assistant. Analyze the provided meeting transcript and timestamped segments.
Return ONLY a valid JSON object with the exact structure below:
{
  "title": "Short descriptive meeting title in ${analysisLanguage}",
  "translatedTranscript": "Full accurate translation of the transcript into ${analysisLanguage}. If the transcript is already in ${analysisLanguage}, return the cleaned transcript in ${analysisLanguage}.",
  "diarizedSegments": [
    {
      "speaker": "Speaker 1",
      "start": 0.0,
      "end": 5.2,
      "text": "Segment text translated or kept in ${analysisLanguage}"
    }
  ],
  "summary": {
    "executiveSummary": "A clear 3-4 sentence summary in ${analysisLanguage}",
    "keyPoints": ["Key point 1 in ${analysisLanguage}", "Key point 2 in ${analysisLanguage}"],
    "actionItems": [
      { "task": "Specific action item in ${analysisLanguage}", "owner": "Speaker/Person responsible or Unassigned" }
    ]
  }
}
Infer speaker changes (Speaker 1, Speaker 2, etc.) from conversational turns, questions, and topic shifts across the segments.`;

    let completion = null;
    let lastModelError = null;

    for (const modelName of CANDIDATE_MODELS) {
      try {
        completion = await groq.chat.completions.create({
          model: modelName,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                detectedLanguage,
                targetLanguage: analysisLanguage,
                rawTranscript,
                segments: rawSegments,
              }),
            },
          ],
        });
        break;
      } catch (err) {
        lastModelError = err;
      }
    }

    if (!completion) {
      throw lastModelError || new Error("No available Groq chat model succeeded.");
    }

    const aiResult = JSON.parse(completion.choices[0].message.content);
    const diarizedSegments = aiResult.diarizedSegments || rawSegments;
    const processingTimeMs = Date.now() - startTime;
    const realTimeFactor =
      audioDurationSec > 0 ? Number((processingTimeMs / 1000 / audioDurationSec).toFixed(3)) : 0;
    const wordCount = rawTranscript.trim() ? rawTranscript.trim().split(/\s+/).length : 0;
    const speakerCount = new Set(diarizedSegments.map((s) => s.speaker)).size || 1;

    return {
      detectedLanguage,
      rawTranscript,
      title: aiResult.title || "Meeting Summary",
      translatedTranscript: aiResult.translatedTranscript || rawTranscript,
      diarizedSegments,
      summary: aiResult.summary || {
        executiveSummary: "",
        keyPoints: [],
        actionItems: [],
      },
      metrics: {
        audioDurationSec,
        processingTimeMs,
        realTimeFactor,
        wordCount,
        speakerCount,
      },
    };
  } catch (error) {
    console.error("Groq Processing Error:", error);
    throw new Error(error?.error?.message || error.message || "Failed to transcribe, translate, and summarize media");
  } finally {
    if (tempExtractedFile && fs.existsSync(tempExtractedFile)) {
      fs.unlinkSync(tempExtractedFile);
    }
  }
};

export const answerMeetingQuestion = async (meeting, question) => {
  const contextPayload = {
    title: meeting.title,
    detectedLanguage: meeting.detectedLanguage,
    targetLanguage: meeting.targetLanguage,
    summary: meeting.summary,
    diarizedSegments: meeting.diarizedSegments,
    rawTranscript: meeting.rawTranscript,
  };

  for (const modelName of CANDIDATE_MODELS) {
    try {
      const completion = await groq.chat.completions.create({
        model: modelName,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are an AI Meeting Assistant. Answer the user's question accurately using ONLY the provided meeting transcript, speaker segments, and summary. Be concise and cite speaker names when relevant.",
          },
          {
            role: "user",
            content: `Meeting Data:\n${JSON.stringify(contextPayload)}\n\nUser Question: ${question}`,
          },
        ],
      });
      return completion.choices[0].message.content;
    } catch (err) {
      // try fallback model
    }
  }
  throw new Error("Failed to generate answer from meeting context.");
};
