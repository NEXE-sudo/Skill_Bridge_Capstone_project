import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signInAs(page: Page, role: "RECRUITER" | "ADMIN") {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: { message: "Sign in required" } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    json: { user: { id: `${role.toLowerCase()}-1`, name: `Taylor ${role}`, email: `${role.toLowerCase()}@example.test`, role } },
    headers: { "Set-Cookie": "skillbridge_session=test-session; HttpOnly; SameSite=Lax; Path=/; Max-Age=600" },
  }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 204 }));
  await page.goto("/login");
  await page.getByLabel("Email address").fill(`${role.toLowerCase()}@example.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("public landing page has no automated WCAG 2.1 A/AA violations", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: { message: "Sign in required" } } }));
  await page.route("**/api/jobs**", (route) => route.fulfill({ json: { items: [], pagination: { total: 0, totalPages: 0 } } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /turn your skills into a career/i })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("student can sign in and log out without a browser-stored bearer token", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: { message: "Sign in required" } } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    json: { user: { id: "student-1", name: "Ava Student", email: "ava@example.test", role: "STUDENT" } },
    headers: { "Set-Cookie": "skillbridge_session=test-session; HttpOnly; SameSite=Lax; Path=/; Max-Age=600" },
  }));
  await page.route("**/api/student/dashboard", (route) => route.fulfill({
    json: { applications: { total: 0, counts: {}, recent: [] }, savedJobs: 0, recommendations: [] },
  }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 204 }));

  await page.goto("/login");
  await page.getByLabel("Email address").fill("ava@example.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Welcome back, Ava" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("skillbridge_token"))).toBeNull();
  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
});

test("recruiter can manage a listing and its allowed status", async ({ page }) => {
  let listingStatus = "PUBLISHED";
  await page.route("**/api/recruiter/dashboard", (route) => route.fulfill({
    json: { activeListings: 1, totalApplications: 1, underReview: 1, shortlisted: 0, recentApplications: [], listingPerformance: [] },
  }));
  await page.route("**/api/recruiter/jobs**", async (route) => route.fulfill({
    json: {
      items: [{
        id: "job-1", title: "Frontend Engineer", location: "Remote", jobType: "FULL_TIME", workArrangement: "REMOTE",
        skills: ["TypeScript"], deadline: "2027-01-01", status: listingStatus, description: "Build useful products.",
        responsibilities: [], requirements: [], experienceLevel: "ENTRY", recruiterId: "recruiter-1",
        _count: { applications: 1 },
      }],
      pagination: { page: 1, totalPages: 1 },
    },
  }));
  await page.route("**/api/jobs/job-1", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { status: string };
      listingStatus = body.status;
      return route.fulfill({ json: { id: "job-1", status: listingStatus } });
    }
    return route.fulfill({ status: 404, json: { error: { message: "Not found" } } });
  });
  await signInAs(page, "RECRUITER");

  await expect(page.getByRole("heading", { name: "Your hiring overview" })).toBeVisible();
  await page.getByRole("link", { name: "Job listings" }).click();
  await expect(page.getByText("Frontend Engineer")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => listingStatus).toBe("CLOSED");

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("administrator can reach the platform dashboard and audit navigation", async ({ page }) => {
  await page.route("**/api/admin/dashboard", (route) => route.fulfill({
    json: { totalUsers: 4, totalStudents: 2, totalRecruiters: 1, totalListings: 3, publishedListings: 2, totalApplications: 1 },
  }));
  await page.route("**/api/admin/audit-logs**", (route) => route.fulfill({ json: { items: [], pagination: { page: 1, total: 0, totalPages: 0 } } }));
  await signInAs(page, "ADMIN");

  await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit log" })).toBeVisible();
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("No administrative activity recorded")).toBeVisible();
});

test("registration stays signed out until email verification and reset requests are private", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: { message: "Sign in required" } } }));
  await page.route("**/api/auth/register", (route) => route.fulfill({
    status: 201,
    json: { message: "Account created. Check your email to verify your address before signing in." },
  }));
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Ava Student");
  await page.getByLabel("Email address").fill("ava@example.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(/verify your address/i);
  expect(await page.evaluate(() => localStorage.getItem("skillbridge_token"))).toBeNull();

  await page.goto("/forgot-password");
  await page.route("**/api/auth/password-reset/request", (route) => route.fulfill({
    status: 202,
    json: { message: "If an account exists for this address, a password reset email will be sent." },
  }));
  await page.getByLabel("Email address").fill("ava@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(/if an account exists/i);
});

test("account action tokens are removed from the address bar before API exchange", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: { message: "Sign in required" } } }));
  const verificationToken = "v".repeat(48);
  let submittedVerificationToken = "";
  await page.route("**/api/auth/verify-email", async (route) => {
    submittedVerificationToken = route.request().postDataJSON().token;
    await route.fulfill({ json: { message: "Email verified. You can now sign in." } });
  });
  await page.goto(`/verify-email?token=${verificationToken}`);
  await expect(page.getByRole("status")).toContainText("Email verified.");
  expect(new URL(page.url()).search).toBe("");
  expect(submittedVerificationToken).toBe(verificationToken);

  const resetToken = "r".repeat(48);
  let submittedResetToken = "";
  await page.route("**/api/auth/password-reset/confirm", async (route) => {
    submittedResetToken = route.request().postDataJSON().token;
    await route.fulfill({ json: { message: "Password updated successfully." } });
  });
  await page.goto(`/reset-password?token=${resetToken}`);
  await page.getByLabel("New password").fill("A-new-password-123!");
  await page.getByLabel("Confirm password").fill("A-new-password-123!");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated successfully.");
  expect(new URL(page.url()).search).toBe("");
  expect(submittedResetToken).toBe(resetToken);
});
