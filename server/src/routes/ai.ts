import { Router } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { aiStatus, summarizeHistory } from "../ai";
import { requirePatientAccess } from "../middleware/auth";

const router = Router();

// GET /ai/status - check AI configuration
router.get("/status", async (req, res) => {
  try {
    const status = aiStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /ai/summarize - generate AI summary of patient records
router.post("/summarize", requirePatientAccess, async (req: any, res: any) => {
  try {
    const { patientId } = req.body;
    const doctorId = req.user?.userId;

    if (!patientId || !doctorId) {
      return res.status(400).json({ error: "Patient ID and Doctor ID are required" });
    }

    // Verify patient exists and get their records
    const patient = await prisma.user.findUnique({ where: { id: patientId } });
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    // Get all records for this patient
    const records = await prisma.medicalRecord.findMany({
      where: { patientId },
      include: {
        doctor: {
          select: { id: true, name: true, doctorId: true },
        },
      },
      orderBy: { uploadedAt: "desc" },
    });

    if (records.length === 0) {
      return res.status(404).json({ error: "No records found for this patient" });
    }

    const result = await summarizeHistory(patient.name, records);

    // Log the AI summary generation (metadata only, never clinical text or patient secrets)
    await prisma.auditLog.create({
      data: {
        actorType: "DOCTOR",
        actorId: doctorId,
        action: "AI_SUMMARY_GENERATED",
        targetType: "PATIENT_RECORDS",
        targetId: patientId,
        metadata: JSON.stringify({ 
          model: config.groqModel,
          recordCount: records.length,
          recordsUsed: result.recordsUsed,
          recordsSkippedCount: result.recordsSkipped.length,
          summaryLength: result.summary.length 
        }),
      },
    });

    res.json({ 
      success: true, 
      summary: result.summary,
      recordsUsed: result.recordsUsed,
      recordsSkipped: result.recordsSkipped,
      recordCount: records.length 
    });
  } catch (error: any) {
    let errorMessage = error.message || "The AI service is temporarily unavailable, please try again";
    if (errorMessage === "AI is not configured") {
      return res.status(500).json({ error: "AI is not configured" });
    }
    if (errorMessage === "Groq API key was rejected") {
      return res.status(500).json({ error: "Groq API key was rejected" });
    }
    res.status(500).json({ error: "The AI service is temporarily unavailable, please try again" });
  }
});

export default router;