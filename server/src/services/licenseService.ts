import { prisma } from "../db/prisma";

export async function medicalLicenseExists(licenseNumber: string): Promise<boolean> {
  const doctor = await prisma.doctor.findUnique({
    where: { medicalLicenseNumber: licenseNumber },
  });

  return !!doctor;
}