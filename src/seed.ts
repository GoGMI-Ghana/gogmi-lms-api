import bcrypt from "bcrypt";
import { prisma } from "./lib/prisma";
 
async function seed() {
  console.log("🌱 Seeding database...\n");
 
  // ─── Admin ────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash("GoGMI@Admin2026!", 12);
  await prisma.user.upsert({
    where: { email: "admin@gogmi.org.gh" },
    update: {},
    create: { email: "admin@gogmi.org.gh", password: adminPassword, firstName: "Lawrence", lastName: "Dogli", role: "ADMIN", status: "ACTIVE", organization: "GoGMI", jobTitle: "Programmes Manager", country: "Ghana" },
  });
  console.log("✅ Admin: admin@gogmi.org.gh");
 
  // ─── Maritime Governance Course (PAID, published) ─────────
  const mgCourse = await prisma.course.upsert({
    where: { id: "crs_maritime_governance" },
    update: { price: 500, thumbnailImage: "/images/maritime-governance.jpg", published: true },
    create: {
      id: "crs_maritime_governance",
      title: "Maritime Governance",
      subtitle: "Maritime Security Strategy Development and Implementation: A Focus on Africa",
      description: "Equip professionals, stakeholders, and decision-makers with the knowledge, skills, and tools necessary to understand maritime strategy development and implementation within the African context. By exposing participants to key principles and best practices for developing and implementing maritime strategies, the programme will expand the expertise necessary to ensure that African states have the skills they truly need to address their peculiar mix of maritime threats and challenges.",
      category: "Governance",
      level: "Intermediate",
      duration: "2 weeks (8 days)",
      thumbnailCode: "MG",
      thumbnailColor: "bg-brand-navy",
      thumbnailImage: "/images/maritime-governance.jpg",
      price: 500,
      currency: "GHS",
      featured: true,
      published: true,
      format: "Live/Virtual (Zoom) sessions with interactive simulations, presentations, group discussions, forums and assignments. 8 modules over 2 weeks.",
      targetGroup: "Government Agencies, Non-Governmental Organisations, Private Sectors, Industries, Institutions, Students, and the General Public with an interest in the maritime domain.",
    },
  });
 
  // MG Outcomes
  const mgOutcomes = [
    "Develop a team of skilled actors to enhance maritime strategy development processes across the continent",
    "Enhance the implementation of existing continental, regional and national strategies in Africa",
    "Foster more effective inter-agency and NGO coordination toward the implementation of maritime security strategies",
    "Enhance networking opportunities and collaboration among participating stakeholders involved in maritime security across Africa",
  ];
  for (let i = 0; i < mgOutcomes.length; i++) {
    await prisma.courseOutcome.upsert({ where: { id: "mg_outcome_" + i }, update: {}, create: { id: "mg_outcome_" + i, courseId: mgCourse.id, outcome: mgOutcomes[i], order: i } });
  }
 
  const mgTags = ["Maritime Strategy", "African Maritime Security", "Yaoundé Architecture", "ECOWAS", "Stakeholder Analysis", "Interagency Coordination", "SWOT Analysis", "MSSR"];
  for (const tag of mgTags) {
    await prisma.courseTag.upsert({ where: { courseId_tag: { courseId: mgCourse.id, tag } }, update: {}, create: { courseId: mgCourse.id, tag } });
  }
 
  const mgFacilitators = [
    { name: "Prof. Jeffrey Landsman (ret), CAPT, USN (ret)", title: "Lead Facilitator" },
    { name: "Dr. Alberta Ama Sagoe", title: "GoGMI Research" },
    { name: "Vice Admiral Issah Adam Yakubu (ret)", title: "Executive Chairman, GoGMI" },
    { name: "Naval Captain Ebenezer Kwame Yirenkyi", title: "Naval Captain" },
    { name: "Lt. Cmdr. Kofi Amponsah Duodu", title: "GoGMI" },
    { name: "Lawrence Dogli", title: "Programmes Manager, GoGMI" },
    { name: "Juliet Afrah Obeng", title: "GoGMI" },
    { name: "Enoch Nikoi", title: "GoGMI" },
  ];
  for (let i = 0; i < mgFacilitators.length; i++) {
    await prisma.courseFacilitator.upsert({ where: { id: "mg_fac_" + i }, update: {}, create: { id: "mg_fac_" + i, courseId: mgCourse.id, name: mgFacilitators[i].name, title: mgFacilitators[i].title, order: i } });
  }
 
  const mgModules = [
    { title: "Introduction and Maritime Strategy Theory", lessons: [
      { title: "Welcome & Course Overview", facilitator: "Lawrence Dogli & Prof. Jeffrey Landsman", duration: "20 min" },
      { title: "Participants Introduction", facilitator: "Lawrence Dogli", duration: "20 min" },
      { title: "LMS Onboarding", facilitator: "Enoch Nikoi", duration: "20 min" },
      { title: "Strategy Development Directives & Instruments", facilitator: "Dr. Alberta Ama Sagoe", duration: "60 min" },
      { title: "Purpose & Need to Develop Maritime Strategies", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
      { title: "Overview of the Strategy Development Process", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
      { title: "Introduction to Maritime Domain & MSSR", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
    ]},
    { title: "Assessing Maritime Domain Challenges & Opportunities", lessons: [
      { title: "Preliminary Assessment Process", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
      { title: "SWOT Assessment Tool & Maritime Sector Reform", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
      { title: "Group Discussions / SWOT Activity", facilitator: "Lawrence Dogli & Juliet Afrah Obeng", duration: "90 min" },
    ]},
    { title: "Strategy Development Process", lessons: [
      { title: "Developing the Vision Statement", facilitator: "Prof. Jeffrey Landsman", duration: "40 min" },
      { title: "Developing the Vision Statement (Continued)", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
    ]},
    { title: "Interagency Coordination and Stakeholder Analysis", lessons: [
      { title: "Role of Actors/Stakeholders in Maritime Strategy", facilitator: "Naval Captain Ebenezer Kwame Yirenkyi", duration: "60 min" },
      { title: "How Agencies Align Within the Maritime Sector", facilitator: "Naval Captain Ebenezer Kwame Yirenkyi", duration: "45 min" },
      { title: "Importance & Challenges of Interagency Coordination", facilitator: "Lt. Cmdr. Kofi Amponsah Duodu", duration: "60 min" },
    ]},
    { title: "Ends, Ways, Means & Risk", lessons: [
      { title: "Introduction to Ends, Ways, Means & Risk", facilitator: "Prof. Jeffrey Landsman", duration: "40 min" },
      { title: "Ends, Ways, Means Exercise — Part 1", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
    ]},
    { title: "Maritime Strategy Implementation", lessons: [
      { title: "Successes & Failures of Maritime Strategy Implementation", facilitator: "Vice Admiral Issah Adam Yakubu", duration: "60 min" },
      { title: "Maritime Sector Planning Process — COA Development", facilitator: "Prof. Jeffrey Landsman", duration: "60 min" },
      { title: "Group Assignment Briefing", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
    ]},
    { title: "Maritime Strategy Sector Planning — In-Class Exercise", lessons: [
      { title: "Maritime Strategy Sector Planning — In-Class Exercise", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
      { title: "COA Development (Continued)", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
      { title: "COA Brief Finalization", facilitator: "Prof. Jeffrey Landsman", duration: "75 min" },
    ]},
    { title: "Case Study Reports and Course Conclusion", lessons: [
      { title: "Groups Present COA Development & Justification", facilitator: "Prof. Jeffrey Landsman & GoGMI Staff", duration: "60 min" },
      { title: "Group Presentations (Continued)", facilitator: "Prof. Jeffrey Landsman", duration: "45 min" },
      { title: "Course Conclusion & Discussion", facilitator: "Prof. Jeffrey Landsman", duration: "45 min" },
      { title: "Evaluation of Course", facilitator: "Juliet Afrah Obeng", duration: "30 min" },
    ]},
  ];
 
  for (let i = 0; i < mgModules.length; i++) {
    const mod = await prisma.module.upsert({ where: { id: "mg_mod_" + i }, update: {}, create: { id: "mg_mod_" + i, courseId: mgCourse.id, title: mgModules[i].title, order: i } });
    for (let j = 0; j < mgModules[i].lessons.length; j++) {
      const l = mgModules[i].lessons[j];
      await prisma.lesson.upsert({ where: { id: "mg_les_" + i + "_" + j }, update: {}, create: { id: "mg_les_" + i + "_" + j, moduleId: mod.id, title: l.title, facilitator: l.facilitator, duration: l.duration, order: j } });
    }
  }
 
  // ─── Sample access codes for MG (for testing) ────────────
  const sampleCodes = ["GOGMI-MG-2026-001", "GOGMI-MG-2026-002", "GOGMI-MG-2026-003", "GOGMI-MG-2026-004", "GOGMI-MG-2026-005"];
  for (const code of sampleCodes) {
    await prisma.courseAccessCode.upsert({
      where: { courseId_code: { courseId: mgCourse.id, code } },
      update: {},
      create: { courseId: mgCourse.id, code },
    });
  }
 
  console.log("✅ Maritime Governance: 8 modules, GHS 500, 5 access codes");
 
  // ─── Marine Casualty (NOT published — hasn't started) ─────
  await prisma.course.upsert({
    where: { id: "crs_marine_casualty" },
    update: { published: false, thumbnailImage: "/images/marine-casualty.jpg" },
    create: {
      id: "crs_marine_casualty",
      title: "Marine Casualty Investigation and Safety Management",
      subtitle: "Enhancing Maritime and Inland Waterways Transport Safety Frameworks",
      description: "Build competence in marine accident investigation, safety management, and compliance with statutory maritime instruments.",
      category: "Safety",
      level: "Intermediate",
      duration: "6 weeks",
      thumbnailCode: "MC",
      thumbnailColor: "bg-brand-teal",
      thumbnailImage: "/images/marine-casualty.jpg",
      price: 500,
      currency: "GHS",
      featured: false,
      published: false,
      format: "In-person and Virtual.",
      targetGroup: "Maritime Administrations, Transport Authorities, Marine Surveyors.",
    },
  });
 
  console.log("✅ Marine Casualty: unpublished (coming soon)");
 
  // ─── Announcements ────────────────────────────────────────
  await prisma.announcement.upsert({ where: { id: "ann_001" }, update: {}, create: { id: "ann_001", title: "Maritime Governance Course — Cohort 1 Begins May 2026", content: "The Maritime Governance modular course (Cohort 1 — May 2026 Edition) is now live. Ensure you have access to Zoom and a reliable internet connection.", audience: "all", author: "GoGMI Admin" } });
  await prisma.announcement.upsert({ where: { id: "ann_002" }, update: {}, create: { id: "ann_002", title: "Marine Casualty Investigation — Coming Soon", content: "Details for the Marine Casualty Investigation course will be announced shortly.", audience: "all", author: "Programme Office" } });
 
  console.log("✅ Announcements seeded");
  console.log("\n🌱 Done! Test access codes: GOGMI-MG-2026-001 through 005");
}
 
seed()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
 
