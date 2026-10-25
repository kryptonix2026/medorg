import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface SampleDocConfig {
  title: string;
  recordType: "REPORT" | "PRESCRIPTION";
  patientName: string;
  patientMedOrgId: string;
  doctorName: string;
  doctorHospital: string;
  sections: Array<{
    heading: string;
    lines: string[];
  }>;
}

export async function generateClinicalPdf(config: SampleDocConfig): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  let y = height - 40;

  // Header Title
  page.drawText("MEDORG CLINICAL DOCUMENTATION", {
    x: 50,
    y,
    size: 15,
    font: fontBold,
    color: rgb(0.08, 0.22, 0.45),
  });
  y -= 20;

  page.drawText(`${config.recordType}: ${config.title}`, {
    x: 50,
    y,
    size: 12,
    font: fontBold,
    color: rgb(0.12, 0.12, 0.12),
  });
  y -= 16;

  page.drawText(
    `Patient: ${config.patientName} (${config.patientMedOrgId})   |   Provider: ${config.doctorName}`,
    { x: 50, y, size: 9, font: fontRegular, color: rgb(0.3, 0.3, 0.3) }
  );
  y -= 14;

  page.drawText(`Facility: ${config.doctorHospital}   |   Date: March 15, 2024`, {
    x: 50,
    y,
    size: 9,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 16;

  // Horizontal divider
  page.drawLine({
    start: { x: 50, y },
    end: { x: width - 50, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 22;

  // Sections
  for (const section of config.sections) {
    if (y < 80) break;
    page.drawText(section.heading.toUpperCase(), {
      x: 50,
      y,
      size: 10,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });
    y -= 16;

    for (const line of section.lines) {
      if (y < 60) break;
      page.drawText(line, {
        x: 55,
        y,
        size: 9,
        font: fontRegular,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= 14;
    }
    y -= 10;
  }

  // Footer Disclaimer
  page.drawLine({
    start: { x: 50, y: 45 },
    end: { x: width - 50, y: 45 },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  });
  page.drawText(
    "Confidential Medical Record - For authorized healthcare provider use only.",
    { x: 50, y: 32, size: 8, font: fontRegular, color: rgb(0.5, 0.5, 0.5) }
  );

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

export const SAMPLE_RECORD_DATA: Record<string, SampleDocConfig> = {
  "Complete Blood Count, March Report": {
    title: "Complete Blood Count, March Report",
    recordType: "REPORT",
    patientName: "Meera Raghavan",
    patientMedOrgId: "MED-000001",
    doctorName: "Dr. Aisha Nair",
    doctorHospital: "St. Helena Medical Center",
    sections: [
      {
        heading: "Clinical History & Indications",
        lines: [
          "Reason for visit: Routine annual evaluation and mild fatigue assessment.",
          "Patient has history of mild essential hypertension.",
        ],
      },
      {
        heading: "Laboratory Findings - Hematology",
        lines: [
          "White Blood Cell (WBC): 6.8 x 10^3 / uL (Normal: 4.5 - 11.0)",
          "Red Blood Cell (RBC): 4.45 x 10^6 / uL (Normal: 4.10 - 5.10)",
          "Hemoglobin (Hgb): 13.8 g/dL (Normal: 12.0 - 15.5)",
          "Hematocrit (Hct): 41.2 % (Normal: 37.0 - 48.0)",
          "Platelet Count: 245 x 10^3 / uL (Normal: 150 - 450)",
          "Mean Corpuscular Volume (MCV): 88.5 fL (Normal: 80 - 100)",
        ],
      },
      {
        heading: "Physician Assessment & Plan",
        lines: [
          "1. CBC panel is completely unremarkable with normal erythrocyte indices.",
          "2. No evidence of anemia, leukocytosis, or thrombocytopenia.",
          "3. Continue current preventative measures and follow-up in 12 months.",
        ],
      },
    ],
  },
  "Lisinopril 10mg - Monthly Refill": {
    title: "Lisinopril 10mg - Monthly Refill",
    recordType: "PRESCRIPTION",
    patientName: "Meera Raghavan",
    patientMedOrgId: "MED-000001",
    doctorName: "Dr. Aisha Nair",
    doctorHospital: "St. Helena Medical Center",
    sections: [
      {
        heading: "Prescription Order",
        lines: [
          "Medication: Lisinopril 10 mg oral tablet",
          "Sig: Take 1 tablet by mouth daily in the morning with water.",
          "Dispense Quantity: 30 tablets (30-day supply). Refills: 3 remaining.",
          "Diagnosis: Essential Hypertension (ICD-10 I10).",
        ],
      },
      {
        heading: "Monitoring & Instructions",
        lines: [
          "Blood pressure target: < 130/80 mmHg.",
          "Recent resting BP reading: 124/78 mmHg on current regimen.",
          "Monitor renal panel and serum potassium periodically.",
          "Instructed to report persistent dry cough or dizziness.",
        ],
      },
    ],
  },
  "MRI Brain Scan Results": {
    title: "MRI Brain Scan Results",
    recordType: "REPORT",
    patientName: "Thomas Keller",
    patientMedOrgId: "MED-000002",
    doctorName: "Dr. Rafael Ortiz",
    doctorHospital: "Bayview General Hospital",
    sections: [
      {
        heading: "Examination Protocol",
        lines: [
          "Multi-sequence multi-planar MRI of the brain without intravenous gadolinium contrast.",
          "Clinical Indication: Intermittent tension headaches and surveillance.",
        ],
      },
      {
        heading: "Imaging Findings",
        lines: [
          "Cerebral parenchyma demonstrates normal signal intensity throughout.",
          "No acute intracranial hemorrhage, territorial infarction, or mass effect.",
          "Ventricles and basal cisterns are age-appropriate in size and configuration.",
          "Minor non-specific punctate T2/FLAIR hyperintensities in subcortical white matter, consistent with chronic microvascular changes.",
        ],
      },
      {
        heading: "Impression",
        lines: [
          "1. No acute intracranial pathology.",
          "2. Age-appropriate non-specific microvascular white matter changes.",
        ],
      },
    ],
  },
  "Metformin 500mg - Daily Dosage": {
    title: "Metformin 500mg - Daily Dosage",
    recordType: "PRESCRIPTION",
    patientName: "Thomas Keller",
    patientMedOrgId: "MED-000002",
    doctorName: "Dr. Rafael Ortiz",
    doctorHospital: "Bayview General Hospital",
    sections: [
      {
        heading: "Prescription Order",
        lines: [
          "Medication: Metformin Hydrochloride 500 mg oral tablet",
          "Sig: Take 1 tablet twice daily with meals (morning and evening).",
          "Quantity: 60 tablets. Refills: 5.",
          "Indication: Type 2 Diabetes Mellitus (ICD-10 E11.9).",
        ],
      },
      {
        heading: "Clinical Notes & Goals",
        lines: [
          "Target HbA1c: < 7.0%. Most recent HbA1c: 6.8%.",
          "Renal function normal with eGFR > 75 mL/min.",
          "Counselled on balanced diet, regular exercise, and glycemic self-monitoring.",
        ],
      },
    ],
  },
};
