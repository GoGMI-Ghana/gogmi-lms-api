import mysql from "mysql2/promise";
import { env } from "../config/env";

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.HOSTINGER_DB_HOST,
      port: 3306,
      user: env.HOSTINGER_DB_USER,
      password: env.HOSTINGER_DB_PASSWORD,
      database: env.HOSTINGER_DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 10000,
    });
  }
  return pool;
}

export interface RegistrationRecord {
  id: number;
  membership_id: string;
  full_name: string;
  email: string;
  phone: string;
  position: string;
  institution: string;
  country: string;
  applicant_type: string;
  amount_ghs: number;
  course_certificate_id: string;
  status: string;
}

/**
 * Verify a course certificate ID against the Hostinger website database.
 * Returns the registration record if found, null otherwise.
 */
export async function verifyCertificateId(
  certificateId: string
): Promise<RegistrationRecord | null> {
  try {
    const db = getPool();
    const [rows] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM maritime_governance_registrations WHERE course_certificate_id = ? AND status = 'registered' LIMIT 1",
      [certificateId]
    );

    if (rows.length === 0) return null;
    return rows[0] as RegistrationRecord;
  } catch (err) {
    console.error("Hostinger DB verification error:", err);
    throw new Error("Unable to verify certificate. Please try again later.");
  }
}