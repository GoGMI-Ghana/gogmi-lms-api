import bcrypt from "bcrypt";
import { prisma } from "./lib/prisma";

async function seed() {
  console.log("🌱 Seeding database...\n");

  // ─── Admin user ───────────────────────────────────────────
  const adminPassword = await bcrypt.hash("GoGMI@Admin2026!", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@gogmi.org.gh" },
    update: {},
    create: { email: "admin@gogmi.org.gh", password: adminPassword, firstName: "Lawrence", lastName: "Dogli", role: "ADMIN", status: "ACTIVE", organization: "GoGMI", jobTitle: "Programmes Manager", country: "Ghana" },
  });
  console.log("✅ Admin:", admin.email);

  // ─── Maritime Governance Course ───────────────────────────
  const mgCourse = await prisma.course.upsert({
    where: { id: "crs_maritime_governance" },
    update: {},
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
      price: 0,
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
    await prisma.courseOutcome.upsert({
      where: { id: `mg_outcome_${i}` },
      update: {},
      create: { id: `mg_outcome_${i}`, courseId: mgCourse.id, outcome: mgOutcomes[i], order: i },
    });
  }

  // MG Tags
  const mgTags = ["Maritime Strategy", "African Maritime Security", "Yaoundé Architecture", "ECOWAS", "Stakeholder Analysis", "Interagency Coordination", "SWOT Analysis", "MSSR"];
  for (const tag of mgTags) {
    await prisma.courseTag.upsert({
      where: { courseId_tag: { courseId: mgCourse.id, tag } },
      update: {},
      create: { courseId: mgCourse.id, tag },
    });
  }

  // MG Facilitators
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
    await prisma.courseFacilitator.upsert({
      where: { id: `mg_fac_${i}` },
      update: {},
      create: { id: `mg_fac_${i}`, courseId: mgCourse.id, name: mgFacilitators[i].name, title: mgFacilitators[i].title, order: i },
    });
  }

  // MG Modules & Lessons
  const mgModules = [
    {
      title: "Introduction and Maritime Strategy Theory",
      lessons: [
        { title: "Welcome & Course Overview", facilitator: "Lawrence Dogli & Prof. Jeffrey Landsman", duration: "20 min" },
        { title: "Participants Introduction", facilitator: "Lawrence Dogli", duration: "20 min" },
        { title: "LMS Onboarding", facilitator: "Enoch Nikoi", duration: "20 min" },
        { title: "Strategy Development Directives & Instruments", facilitator: "Dr. Alberta Ama Sagoe", duration: "60 min" },
        { title: "Purpose & Need to Develop Maritime Strategies", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
        { title: "Overview of the Strategy Development Process", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
        { title: "Introduction to Maritime Domain & MSSR", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
      ],
    },
    {
      title: "Assessing Maritime Domain Challenges & Opportunities",
      lessons: [
        { title: "Preliminary Assessment Process", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
        { title: "SWOT Assessment Tool & Maritime Sector Reform", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
        { title: "Group Discussions / SWOT Activity", facilitator: "Lawrence Dogli & Juliet Afrah Obeng", duration: "90 min" },
      ],
    },
    {
      title: "Strategy Development Process",
      lessons: [
        { title: "Developing the Vision Statement", facilitator: "Prof. Jeffrey Landsman", duration: "40 min" },
        { title: "Developing the Vision Statement (Continued)", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
      ],
    },
    {
      title: "Interagency Coordination and Stakeholder Analysis",
      lessons: [
        { title: "Role of Actors/Stakeholders in Maritime Strategy", facilitator: "Naval Captain Ebenezer Kwame Yirenkyi", duration: "60 min" },
        { title: "How Agencies Align Within the Maritime Sector", facilitator: "Naval Captain Ebenezer Kwame Yirenkyi", duration: "45 min" },
        { title: "Importance & Challenges of Interagency Coordination", facilitator: "Lt. Cmdr. Kofi Amponsah Duodu", duration: "60 min" },
      ],
    },
    {
      title: "Ends, Ways, Means & Risk",
      lessons: [
        { title: "Introduction to Ends, Ways, Means & Risk", facilitator: "Prof. Jeffrey Landsman", duration: "40 min" },
        { title: "Ends, Ways, Means Exercise — Part 1", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
      ],
    },
    {
      title: "Maritime Strategy Implementation",
      lessons: [
        { title: "Successes & Failures of Maritime Strategy Implementation", facilitator: "Vice Admiral Issah Adam Yakubu", duration: "60 min" },
        { title: "Maritime Sector Planning Process — COA Development", facilitator: "Prof. Jeffrey Landsman", duration: "60 min" },
        { title: "Group Assignment Briefing", facilitator: "Prof. Jeffrey Landsman", duration: "30 min" },
      ],
    },
    {
      title: "Maritime Strategy Sector Planning — In-Class Exercise",
      lessons: [
        { title: "Maritime Strategy Sector Planning — In-Class Exercise", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
        { title: "COA Development (Continued)", facilitator: "Prof. Jeffrey Landsman", duration: "90 min" },
        { title: "COA Brief Finalization", facilitator: "Prof. Jeffrey Landsman", duration: "75 min" },
      ],
    },
    {
      title: "Case Study Reports and Course Conclusion",
      lessons: [
        { title: "Groups Present COA Development & Justification", facilitator: "Prof. Jeffrey Landsman & GoGMI Staff", duration: "60 min" },
        { title: "Group Presentations (Continued)", facilitator: "Prof. Jeffrey Landsman", duration: "45 min" },
        { title: "Course Conclusion & Discussion", facilitator: "Prof. Jeffrey Landsman", duration: "45 min" },
        { title: "Evaluation of Course", facilitator: "Juliet Afrah Obeng", duration: "30 min" },
      ],
    },
  ];

  for (let i = 0; i < mgModules.length; i++) {
    const mod = await prisma.module.upsert({
      where: { id: `mg_mod_${i}` },
      update: {},
      create: { id: `mg_mod_${i}`, courseId: mgCourse.id, title: mgModules[i].title, order: i },
    });
    for (let j = 0; j < mgModules[i].lessons.length; j++) {
      const l = mgModules[i].lessons[j];
      await prisma.lesson.upsert({
        where: { id: `mg_les_${i}_${j}` },
        update: {},
        create: { id: `mg_les_${i}_${j}`, moduleId: mod.id, title: l.title, facilitator: l.facilitator, duration: l.duration, order: j },
      });
    }
  }

  console.log("✅ Maritime Governance course seeded with", mgModules.length, "modules");

  // ─── Marine Casualty Investigation Course ─────────────────
  const mcCourse = await prisma.course.upsert({
    where: { id: "crs_marine_casualty" },
    update: {},
    create: {
      id: "crs_marine_casualty",
      title: "Marine Casualty Investigation and Safety Management",
      subtitle: "Enhancing Maritime and Inland Waterways Transport Safety Frameworks",
      description: "Build competence in marine accident investigation, safety management, and compliance with statutory maritime instruments. Covers the IMO Casualty Investigation Code, SOLAS requirements, evidence handling, root cause analysis, human factors, and safety data management. The course equips practitioners with hands-on skills in accident investigation, evidence management, data reporting/analysis, and safety governance.",
      category: "Safety",
      level: "Intermediate",
      duration: "6 weeks",
      thumbnailCode: "MC",
      thumbnailColor: "bg-brand-teal",
      price: 500,
      currency: "GHS",
      featured: true,
      published: true,
      format: "In-person (Ghana-based participants) and Virtual (International participants). Interactive lectures, regulatory framework analysis, tabletop exercises, simulation, group case analysis, roleplay exercises, report-writing and peer review sessions, field scenario (Volta Lake case-based simulation).",
      targetGroup: "Maritime Law Enforcement Agencies, Maritime Administrations, National and Regional Transport Authorities, Marine Surveyors, Maritime Lawyers and Prosecutors, Vessel Operators and Safety Managers, Representatives from Academia and Civil Society working in Maritime Safety and Governance.",
    },
  });

  const mcOutcomes = [
    "Conduct credible and procedurally compliant marine casualty investigations",
    "Apply the IMO Casualty Investigation Code to real-world accident cases",
    "Draft clear, evidence-based investigation reports and safety recommendations",
    "Strengthen institutional learning and accident prevention mechanisms",
    "Support building a national accident database for safety policy formulation",
  ];
  for (let i = 0; i < mcOutcomes.length; i++) {
    await prisma.courseOutcome.upsert({
      where: { id: `mc_outcome_${i}` },
      update: {},
      create: { id: `mc_outcome_${i}`, courseId: mcCourse.id, outcome: mcOutcomes[i], order: i },
    });
  }

  const mcTags = ["Marine Casualty", "Investigation", "IMO CIC", "SOLAS", "Safety Management", "Human Factors", "Evidence Handling", "Root Cause Analysis"];
  for (const tag of mcTags) {
    await prisma.courseTag.upsert({
      where: { courseId_tag: { courseId: mcCourse.id, tag } },
      update: {},
      create: { courseId: mcCourse.id, tag },
    });
  }

  const mcModules = [
    {
      title: "Marine Casualty Investigation — Concepts, Scope and Legal Framework",
      lessons: [
        { title: "Philosophy and Importance of Marine Casualty Investigation", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Nature, Types and Legal Classification of Marine Casualties", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "IMO Casualty Investigation Code and SOLAS Requirements", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Legal and Institutional Frameworks (Ghana Shipping Act 645)", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Roles of Maritime Administration, Wreck Commissioner, and Assessors", facilitator: "GoGMI Faculty", duration: "45 min" },
        { title: "Procedures: Preliminary Inquiry, Formal Investigation, The Stop Rule", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Inter-agency Coordination and Responsibilities", facilitator: "GoGMI Faculty", duration: "45 min" },
      ],
    },
    {
      title: "Investigation Procedures and Evidence Handling",
      lessons: [
        { title: "Step-by-Step Process of Investigation", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Scene Management and Preservation of Evidence", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Witness Interviewing and Record-Keeping", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Causal Chain and Root Cause Analysis Models", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Drafting Structured Investigation Reports", facilitator: "GoGMI Faculty", duration: "60 min" },
      ],
    },
    {
      title: "Safety Data Management and Reporting",
      lessons: [
        { title: "Standard Formats for Casualty Reporting and Documentation", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Integration of Data into National and IMO Systems (GISIS)", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Safety Trend Analysis and Data Visualisation Techniques", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Developing Feedback Loops for Policy Improvement", facilitator: "GoGMI Faculty", duration: "60 min" },
      ],
    },
    {
      title: "Human Factors, Safety Culture, and Crisis Response",
      lessons: [
        { title: "Human Performance, Organisational Culture, and Accident Causation", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Decision-Making Under Pressure and Coordination Failures", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Communication and Leadership During Emergency Response", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Promoting Proactive Safety Behaviour Across Agencies and Communities", facilitator: "GoGMI Faculty", duration: "60 min" },
      ],
    },
    {
      title: "Basic Analysis of Marine Casualties",
      lessons: [
        { title: "Purpose and Principles of Casualty Analysis", facilitator: "GoGMI Faculty", duration: "45 min" },
        { title: "Critical Thinking in Marine Casualty Contexts", facilitator: "GoGMI Faculty", duration: "45 min" },
        { title: "Causation Models — Human Factors Analysis and Classification System", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Basic Analytical Techniques — Safety Issues and Deficiencies", facilitator: "GoGMI Faculty", duration: "60 min" },
        { title: "Evaluating Evidence and Drawing Conclusions", facilitator: "GoGMI Faculty", duration: "45 min" },
      ],
    },
    {
      title: "Case Study — Mock Marine Accident Investigation and Report",
      lessons: [
        { title: "Case Scenario Briefing and Evidence Pack Distribution", facilitator: "GoGMI Faculty", duration: "30 min" },
        { title: "Group Investigation Exercise — Evidence Evaluation and Root Cause Identification", facilitator: "GoGMI Faculty", duration: "120 min" },
        { title: "Group Investigation Exercise — Sequence of Events and Findings", facilitator: "GoGMI Faculty", duration: "90 min" },
        { title: "Formal Investigation Report Drafting", facilitator: "GoGMI Faculty", duration: "120 min" },
        { title: "Group Presentations and Peer Review", facilitator: "GoGMI Faculty", duration: "90 min" },
        { title: "Course Conclusion, Evaluation and Certificates", facilitator: "GoGMI Faculty", duration: "30 min" },
      ],
    },
  ];

  for (let i = 0; i < mcModules.length; i++) {
    const mod = await prisma.module.upsert({
      where: { id: `mc_mod_${i}` },
      update: {},
      create: { id: `mc_mod_${i}`, courseId: mcCourse.id, title: mcModules[i].title, order: i },
    });
    for (let j = 0; j < mcModules[i].lessons.length; j++) {
      const l = mcModules[i].lessons[j];
      await prisma.lesson.upsert({
        where: { id: `mc_les_${i}_${j}` },
        update: {},
        create: { id: `mc_les_${i}_${j}`, moduleId: mod.id, title: l.title, facilitator: l.facilitator, duration: l.duration, order: j },
      });
    }
  }

  console.log("✅ Marine Casualty course seeded with", mcModules.length, "modules");

  // ─── Announcements ────────────────────────────────────────
  await prisma.announcement.upsert({
    where: { id: "ann_001" },
    update: {},
    create: { id: "ann_001", title: "Maritime Governance Course — Cohort 1 Begins May 2026", content: "The Maritime Governance modular course (Cohort 1 — May 2026 Edition) is now live. Ensure you have access to Zoom and a reliable internet connection. Check your course materials on the LMS.", audience: "all", author: "GoGMI Admin" },
  });
  await prisma.announcement.upsert({
    where: { id: "ann_002" },
    update: {},
    create: { id: "ann_002", title: "Marine Casualty Investigation — Registration Open", content: "The Executive Training Course on Marine Casualty Investigation and Safety Management is now open for enrollment. In-person and virtual options available. GHS 500.", audience: "all", author: "Programme Office" },
  });

  console.log("✅ Announcements seeded");
  console.log("\n🌱 Seeding complete!");
}

seed()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });