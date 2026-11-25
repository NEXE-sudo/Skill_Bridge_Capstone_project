import { PrismaClient, Role, AccountStatus, JobStatus, JobType, WorkArrangement, ExperienceLevel, ApplicationStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const pick = <T>(items: T[], index: number) => items[index % items.length];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The synthetic seed is disabled in production");
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) throw new Error("ADMIN_SEED_PASSWORD must be at least 12 characters");
  const adminEmail = process.env.ADMIN_SEED_EMAIL ?? "admin@skillbridge.local";

  const passwordHash = await bcrypt.hash("Student123!", 12);
  const recruiterHash = await bcrypt.hash("Recruiter123!", 12);
  const adminHash = await bcrypt.hash(adminPassword, 12);

  await prisma.auditLog.deleteMany();
  await prisma.application.deleteMany();
  await prisma.savedJob.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.recruiterProfile.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({
    data: {
      name: "SkillBridge Administrator",
      email: adminEmail,
      passwordHash: adminHash,
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    },
  });

  const recruiters = await Promise.all([
    prisma.user.create({
      data: {
        name: "Aarav Mehta",
        email: "recruiter1@skillbridge.local",
        passwordHash: recruiterHash,
        role: Role.RECRUITER,
        recruiterProfile: { create: { organisation: "NovaTech Labs", designation: "Talent Partner", industry: "Software", location: "Bengaluru", website: "https://example.com", description: "Building practical products for modern teams." } },
      },
    }),
    prisma.user.create({
      data: {
        name: "Diya Shah",
        email: "recruiter2@skillbridge.local",
        passwordHash: recruiterHash,
        role: Role.RECRUITER,
        recruiterProfile: { create: { organisation: "Greenfield Analytics", designation: "Recruiting Lead", industry: "Data & Analytics", location: "Pune", website: "https://example.com", description: "Data-led solutions for growing businesses." } },
      },
    }),
  ]);

  const students = await Promise.all(
    ["Ananya Rao", "Karan Verma", "Meera Iyer"].map((name, i) =>
      prisma.user.create({
        data: {
          name,
          email: `student${i + 1}@skillbridge.local`,
          passwordHash,
          role: Role.STUDENT,
          studentProfile: {
            create: {
              location: ["Bengaluru", "Mumbai", "Chennai"][i],
              university: ["National Institute of Technology", "University of Mumbai", "Anna University"][i],
              degree: "B.Tech",
              branch: ["Computer Science", "Information Technology", "Data Science"][i],
              graduationYear: 2027,
              skills: i === 0 ? ["React", "TypeScript", "Node.js"] : i === 1 ? ["Python", "SQL", "Data Analysis"] : ["Java", "Spring", "SQL"],
              bio: "Final-year student seeking practical early-career opportunities.",
            },
          },
        },
      }),
    ),
  );

  const titles = [
    ["Frontend Developer Intern", "React", "TypeScript"], ["Backend Engineer", "Node.js", "PostgreSQL"],
    ["Data Analyst Intern", "Python", "SQL"], ["Full Stack Developer", "React", "Node.js"],
    ["Java Developer Intern", "Java", "Spring"], ["Cloud Engineering Intern", "AWS", "Linux"],
    ["UI/UX Design Intern", "Figma", "Design Systems"], ["QA Automation Intern", "JavaScript", "Playwright"],
    ["Machine Learning Intern", "Python", "Machine Learning"], ["Product Analyst", "SQL", "Analytics"],
    ["DevOps Intern", "Docker", "CI/CD"], ["Mobile App Developer", "React Native", "TypeScript"],
    ["Cybersecurity Analyst", "Security", "Networking"], ["Business Analyst Intern", "Excel", "Communication"],
    ["Software Engineer Graduate", "Java", "PostgreSQL"], ["Data Science Intern", "Python", "Pandas"],
  ] as const;

  const jobs = [];
  for (let i = 0; i < titles.length; i++) {
    const [title, skill1, skill2] = titles[i];
    const recruiter = recruiters[i % recruiters.length];
    const job = await prisma.job.create({
      data: {
        recruiterId: recruiter.id,
        title,
        description: `Join ${recruiter.recruiterProfile ? "our team" : "our team"} to build reliable, user-focused solutions. This role includes mentoring, practical ownership, and exposure to production-quality workflows.`,
        responsibilities: ["Collaborate with cross-functional teams", "Build and test product features", "Review work and document outcomes"],
        requirements: ["Strong fundamentals", "Clear communication", "Ability to learn new tools"],
        skills: [skill1, skill2],
        jobType: i % 3 === 0 ? JobType.INTERNSHIP : i % 5 === 0 ? JobType.CONTRACT : JobType.FULL_TIME,
        workArrangement: pick([WorkArrangement.REMOTE, WorkArrangement.HYBRID, WorkArrangement.ON_SITE], i),
        location: pick(["Bengaluru", "Pune", "Mumbai", "Remote"], i),
        experienceLevel: i < 8 ? ExperienceLevel.ENTRY : ExperienceLevel.MID,
        salaryMin: i % 3 === 0 ? 20000 : 350000,
        salaryMax: i % 3 === 0 ? 40000 : 700000,
        deadline: new Date(Date.now() + (30 + i) * 86400000),
        status: i === 13 ? JobStatus.CLOSED : i === 14 ? JobStatus.DRAFT : JobStatus.PUBLISHED,
      },
    });
    jobs.push(job);
  }

  for (let i = 0; i < 8; i++) {
    await prisma.application.create({
      data: {
        jobId: jobs[i].id,
        studentId: students[i % students.length].id,
        status: pick([ApplicationStatus.APPLIED, ApplicationStatus.UNDER_REVIEW, ApplicationStatus.SHORTLISTED, ApplicationStatus.REJECTED], i),
        coverLetter: "I am excited to contribute to this role and apply my technical foundations.",
      },
    });
  }

  await prisma.savedJob.createMany({
    data: [
      { studentId: students[0].id, jobId: jobs[0].id },
      { studentId: students[0].id, jobId: jobs[3].id },
      { studentId: students[1].id, jobId: jobs[2].id },
    ],
  });

  for (const student of students) {
    await prisma.notification.create({
      data: { userId: student.id, title: "Welcome to SkillBridge", message: "Complete your profile to receive better role recommendations.", type: "INFO" },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
