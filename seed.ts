import bcrypt from "bcrypt";
import { prisma } from "./lib/prisma";

async function seed() {
  console.log("🌱 Seeding database...\n");

  // Create initial admin user
  const adminPassword = await bcrypt.hash("GoGMI@Admin2026!", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@gogmi.org.gh" },
    update: {},
    create: {
      email: "admin@gogmi.org.gh",
      password: adminPassword,
      firstName: "Lawrence",
      lastName: "Dogli",
      role: "ADMIN",
      status: "ACTIVE",
      organization: "GoGMI",
      jobTitle: "Programmes Manager",
      country: "Ghana",
    },
  });

  console.log(`✅ Admin user created: ${admin.email}`);
  console.log(`   Password: GoGMI@Admin2026!`);
  console.log(`   ⚠️  Change this password immediately after first login!\n`);

  // Create test student
  const studentPassword = await bcrypt.hash("Student@2026!", 12);

  const student = await prisma.user.upsert({
    where: { email: "student@gogmi.org.gh" },
    update: {},
    create: {
      email: "student@gogmi.org.gh",
      password: studentPassword,
      firstName: "Kwame",
      lastName: "Asante",
      role: "STUDENT",
      status: "ACTIVE",
      organization: "Ghana Maritime Authority",
      jobTitle: "Maritime Security Analyst",
      country: "Ghana",
    },
  });

  console.log(`✅ Test student created: ${student.email}`);
  console.log(`   Password: Student@2026!\n`);

  console.log("🌱 Seeding complete!");
}

seed()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
