import { Router } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";
import multer from "multer";
import path from "path";
import { storage } from "../storage";
import { invalidatePdfCache } from "../ai/pdfExtractor";

// RecordType type
type RecordType = "REPORT" | "PRESCRIPTION";

// Filter: PDF only
const fileFilter = (req: any, file: any, cb: any) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk = file.mimetype === "application/pdf";
  if (ext !== ".pdf" || !mimeOk) {
    return cb(new Error("Only PDF files are allowed"), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
});

const router = Router();

// Doctor uploads a PDF record
router.post("/upload", upload.single("record"), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Please select a PDF file." });
    }

    const { patientId, doctorId, recordType, title, description } = req.body;

    if (!patientId || !doctorId || !recordType) {
      return res.status(400).json({ error: "Patient ID, Doctor ID, and record type are required" });
    }

    // Validate record type
    const validTypes: RecordType[] = ["REPORT", "PRESCRIPTION"];
    if (!validTypes.includes(recordType as RecordType)) {
      return res.status(400).json({ error: "Invalid record type" });
    }

    // Find patient and doctor
    const patient = await prisma.user.findUnique({ where: { id: patientId } });
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    // Upload via storage abstraction
    const subDir = recordType === "REPORT" ? "reports" : "prescriptions";
    const uploadResult = await storage.upload({
      buffer: req.file.buffer,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      subDir,
    });

    // Create the medical record in database
    const medicalRecord = await prisma.medicalRecord.create({
      data: {
        patientId,
        doctorId,
        recordType: recordType as RecordType,
        title: title || `${recordType} Record`,
        description: description || "",
        originalFileName: req.file.originalname,
        storedFileName: uploadResult.storedFileName,
        filePath: uploadResult.filePath,
        mimeType: req.file.mimetype,
        fileSize: uploadResult.fileSize,
      },
    });

    // Invalidate cached text if any
    invalidatePdfCache(medicalRecord.id);
    await prisma.notification.create({
      data: {
        userType: "PATIENT",
        userId: patient.id,
        type: "RECORD_UPLOADED",
        title: "New Medical Record",
        message: `Dr. ${doctor.name} has uploaded a ${recordType.toLowerCase()} record: ${title || ""}`,
      },
    });

    res.json({ 
      success: true, 
      record: {
        id: medicalRecord.id,
        title: medicalRecord.title,
        recordType: medicalRecord.recordType,
        uploadedAt: medicalRecord.uploadedAt,
      } 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get record metadata
router.get("/:id", async (req, res) => {
  try {
    const recordId = req.params.id;

    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
      include: {
        patient: {
          select: { id: true, name: true, medOrgId: true },
        },
        doctor: {
          select: { id: true, name: true, doctorId: true },
        },
      },
    });

    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    // Never leak filePath or storedFileName
    res.json({ 
      record: {
        id: record.id,
        title: record.title,
        recordType: record.recordType,
        description: record.description,
        originalFileName: record.originalFileName,
        mimeType: record.mimeType,
        fileSize: record.fileSize,
        uploadedAt: record.uploadedAt,
        patient: {
          id: record.patient.id,
          medOrgId: record.patient.medOrgId,
          name: record.patient.name,
        },
        doctor: {
          id: record.doctor.id,
          doctorId: record.doctor.doctorId,
          name: record.doctor.name,
        },
      } 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// View record (stream PDF)
router.get("/:id/view", async (req, res) => {
  try {
    const recordId = req.params.id;

    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    const fileExists = await storage.exists(record.filePath);
    if (!fileExists) {
      return res.status(404).json({ error: "File not found in storage" });
    }

    // Stream the PDF inline
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${record.originalFileName}"`,
    });
    const stream = await storage.getStream(record.filePath);
    stream.pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download record (stream PDF as attachment)
router.get("/:id/download", async (req, res) => {
  try {
    const recordId = req.params.id;

    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      return res.status(404).json({ error: "Record not found" });
    }

    const fileExists = await storage.exists(record.filePath);
    if (!fileExists) {
      return res.status(404).json({ error: "File not found in storage" });
    }

    // Stream the PDF as download
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${record.originalFileName}"`,
    });
    const stream = await storage.getStream(record.filePath);
    stream.pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;