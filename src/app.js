import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import meetingRoutes from "./routes/meetingRoutes.js"; // <-- Import routes

dotenv.config();
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", service: "meeting-ai-backend" });
});

// <-- Use meeting routes
app.use("/api/meetings", meetingRoutes);

app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));