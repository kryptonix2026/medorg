import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { config } from "../config";

const router = Router();

// Doctor looks up patient by exact MedOrg ID
router.post("/lookup", async (req, res) => {
  try {
    const { medOrgId } = req.body;

    if (!medOrgId) {
      return res.status(400).json({ error: "MedOrg ID is required" });
    }

    const user = await prisma.user.findUnique({ where: { medOrgId } });
    
    if (!user) {
      return res.status(404).json({ error: "Patient not found" });
    }

    res.json({ 
      user: { 
        id: user.id, 
        medOrgId: user.medOrgId, 
        name: user.name, 
        email: user.email,
        dateOfBirth: user.dateOfBirth 
      } 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get patient's timeline (patient view)
router.get("/:id/timeline", async (req, res) => {
  try {
    const patientId = req.params.id;

    const records = await prisma.medicalRecord.findMany({
      where: { patientId },
      include: {
        doctor: {
          select: { id: true, name: true, doctorId: true },
        },
      },
      orderBy: { uploadedAt: "desc" },
    });

    res.json({ records });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;