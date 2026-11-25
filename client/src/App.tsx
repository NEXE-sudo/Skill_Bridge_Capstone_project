import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BriefcaseBusiness, Building2, ChevronRight, CircleUserRound, GraduationCap, LayoutDashboard, LogOut, Moon, Search, Sun, UserRound, Users, Bookmark, FileText, Settings, Menu, X } from "lucide-react";
import { api, authExpiredEvent, clearAuth, type Role, type User } from "./api";

const AuthContext = createContext<{ user: User | null; login: (email: string, password: string) => Promise<User>; register: (data: { name: string; email: string; password: string; role: "STUDENT" | "RECRUITER" }) => Promise<void>; logout: () => Promise<void>; loading: boolean }>({ user: null, login: async () => { throw new Error("Unavailable"); }, register: async () => { throw new Error("Unavailable"); }, logout: async () => {}, loading: true });

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  useEffect(() => {
    const handleExpired = () => setUser(null);
    window.addEventListener(authExpiredEvent, handleExpired);
    return () => window.removeEventListener(authExpiredEvent, handleExpired);
  }, []);
  useEffect(() => {
    api<User & { accountStatus: string }>("/api/auth/me").then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);
  async function login(email: string, password: string) {
    const data = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    setUser(data.user); return data.user;
  }
  async function register(payload: { name: string; email: string; password: string; role: "STUDENT" | "RECRUITER" }) {
    await api<{ message: string }>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      clearAuth();
      queryClient.clear();
      setUser(null);
    }
  }
  return <AuthContext.Provider value={{ user, login, register, logout, loading }}>{children}</AuthContext.Provider>;
}
const useAuth = () => useContext(AuthContext);

function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("theme", dark ? "dark" : "light"); }, [dark]);
  return <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Toggle theme">{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
}

function PublicNav() {
  const { user, logout } = useAuth();
  return <header className="public-nav"><Link className="brand" to="/"><span className="brand-mark"><GraduationCap size={22}/></span>SkillBridge</Link><nav><Link to="/jobs">Explore jobs</Link>{user ? <><Link to={`/${user.role.toLowerCase()}/dashboard`}>Dashboard</Link><button className="button ghost" onClick={() => void logout().catch(() => window.alert("You were signed out on this device, but the server could not revoke the session."))}>Log out</button></> : <><Link to="/login">Log in</Link><Link className="button primary" to="/register">Get started</Link></>}</nav></header>;
}

function Landing() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["landingJobs"], queryFn: () => api<{items: Job[]}>("/api/jobs?pageSize=3") });
  return <><PublicNav/><main>
    <section className="hero"><div><span className="eyebrow">Built for your next chapter</span><h1>Turn your skills into a <em>career</em>.</h1><p>Discover focused opportunities, build a professional profile, and track every application in one place.</p><div className="hero-actions"><Link className="button primary large" to="/jobs">Explore opportunities <ChevronRight size={18}/></Link><Link className="button secondary large" to="/register">Create account</Link></div></div><div className="hero-visual" aria-hidden="true"><div className="floating-card"><span className="status-dot"/>Career profile<div className="progress"><i/></div></div><div className="match-card"><span>Made for early careers</span><strong>Find your next step</strong><small>Explore jobs · Track applications</small></div></div></section>
    <section className="featured"><div className="section-heading"><div><span className="eyebrow">Fresh opportunities</span><h2>Featured jobs</h2></div><Link to="/jobs">View all <ChevronRight size={16}/></Link></div>{isError ? <QueryError error={error} retry={refetch}/> : isLoading ? <SkeletonCards/> : data?.items.length ? <div className="job-grid">{data.items.map((job) => <JobCard key={job.id} job={job}/>)}</div> : <Empty text="No opportunities are available right now"/>}</section>
    <section className="how"><span className="eyebrow">How it works</span><h2>Three steps to move forward</h2><div className="steps"><article><span>01</span><h3>Build your profile</h3><p>Highlight skills, education and the experience that makes you stand out.</p></article><article><span>02</span><h3>Find the right fit</h3><p>Search curated internships and jobs with useful, practical filters.</p></article><article><span>03</span><h3>Track your progress</h3><p>Manage applications and status updates from a single clear workspace.</p></article></div></section>
    <section className="audiences"><article><GraduationCap/><h3>For students</h3><p>One organised place for opportunities, applications and career growth.</p></article><article><Building2/><h3>For recruiters</h3><p>Publish listings and evaluate candidates with efficient applicant tools.</p></article></section>
  </main><Footer/></>;
}

function Footer() { return <footer className="footer"><Link className="brand" to="/"><span className="brand-mark"><GraduationCap size={20}/></span>SkillBridge</Link><p>Build skills. Find opportunities. Grow your career.</p><div><Link to="/jobs">Jobs</Link><Link to="/login">Sign in</Link></div></footer>; }

type RecruiterOrganization = { recruiterProfile?: { organisation?: string | null } };
type StudentProfile = {
  phone?: string | null; location?: string | null; university?: string | null; degree?: string | null;
  branch?: string | null; graduationYear?: number | null; bio?: string | null; skills?: string[];
  linkedinUrl?: string | null; githubUrl?: string | null; portfolioUrl?: string | null;
  resumeName?: string | null; resumeSize?: number | null; resumeType?: string | null; resumeUpdatedAt?: string | null;
};
type Job = {
  id: string; title: string; location: string; jobType: string; workArrangement: string; skills: string[];
  salaryMin?: number | null; salaryMax?: number | null; deadline: string; status?: string;
  description?: string; responsibilities?: string[]; requirements?: string[];
  recruiter?: { name?: string; recruiterProfile?: RecruiterOrganization["recruiterProfile"] & { description?: string | null } };
};
type Application = {
  id: string; jobId: string; studentId: string; status: string; appliedAt: string; updatedAt?: string; coverLetter?: string | null;
  job: Job & { recruiter?: RecruiterOrganization };
  student?: User & { studentProfile?: StudentProfile };
};
type ProfileResponse = { user: Pick<User, "id" | "name" | "email">; studentProfile: StudentProfile | null; recruiterProfile: Record<string, string | null> | null };
type RecruiterJob = Job & { description: string; responsibilities: string[]; requirements: string[]; experienceLevel: string; recruiterId: string; _count: { applications: number } };
type AdminUser = { id: string; name: string; email: string; role: Role; accountStatus: string };
type AdminJob = Job & { recruiter?: { recruiterProfile?: RecruiterOrganization["recruiterProfile"] }; _count: { applications: number } };
function JobCard({ job }: { job: Job }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: saved } = useQuery({
    queryKey: ["saved"],
    queryFn: () => api<{ items: { jobId: string }[] }>("/api/saved-jobs"),
    enabled: user?.role === "STUDENT",
  });
  const isSaved = saved?.items.some((item) => item.jobId === job.id) ?? false;
  const save = useMutation({
    mutationFn: () => api(`/api/saved-jobs/${job.id}`, { method: isSaved ? "DELETE" : "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved"] }),
  });
  function toggleSaved() {
    if (user?.role !== "STUDENT") return navigate(user ? "/login" : "/login");
    save.mutate();
  }
  return <article className="job-card"><div className="job-card-top"><span className="company-logo"><Building2 size={20}/></span><button className="icon-button bookmark-button" onClick={toggleSaved} aria-label={isSaved ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`} aria-pressed={isSaved} disabled={save.isPending}><Bookmark size={18} fill={isSaved ? "currentColor" : "none"}/></button></div><div className="tag-row"><span>{job.jobType.replace("_"," ")}</span><span>{job.workArrangement.replace("_"," ")}</span></div><h3>{job.title}</h3><p>{job.recruiter?.recruiterProfile?.organisation ?? "Organisation"}</p><small>{job.location}</small>{save.error && <p className="inline-error" role="alert">{save.error.message}</p>}<Link className="card-link" to={`/jobs/${job.id}`}>View opportunity <ChevronRight size={16}/></Link></article>;
}

function SkeletonCards() {
  return <div className="skeleton-grid" aria-label="Loading opportunities"><i/><i/><i/></div>;
}

function QueryError({ error, retry }: { error: unknown; retry: () => unknown }) {
  return <div className="alert error" role="alert">{error instanceof Error ? error.message : "Unable to load this information"} <button className="button ghost" onClick={() => void retry()}>Try again</button></div>;
}

function AuthPage({ mode }: { mode: "login"|"register" }) {
  const { login, register } = useAuth(); const navigate = useNavigate();
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        const user = await login(String(form.get("email")), String(form.get("password")));
        navigate(`/${user.role.toLowerCase()}/dashboard`);
      } else {
        await register({ name: String(form.get("name")), email: String(form.get("email")), password: String(form.get("password")), role: String(form.get("role")) as "STUDENT"|"RECRUITER" });
        setNotice("Account created. Check your email to verify your address before signing in.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to continue"); } finally { setLoading(false); }
  }
  return <main className="auth-page"><Link className="brand auth-brand" to="/"><span className="brand-mark"><GraduationCap size={22}/></span>SkillBridge</Link><section className="auth-card"><span className="eyebrow">{mode === "login" ? "Welcome back" : "Join SkillBridge"}</span><h1>{mode === "login" ? "Sign in to your workspace" : "Create your account"}</h1>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}<form onSubmit={submit}>{mode === "register" && <label>Full name<input name="name" required minLength={2}/></label>}<label>Email address<input name="email" type="email" required/></label><label>Password<input name="password" type="password" required minLength={8}/></label>{mode === "register" && <label>I am a<select name="role"><option value="STUDENT">Student</option><option value="RECRUITER">Recruiter</option></select></label>}<button className="button primary full" disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form>{mode === "login" && <p><Link to="/forgot-password">Forgot your password?</Link></p>}<p className="auth-switch">{mode === "login" ? "New to SkillBridge?" : "Already have an account?"} <Link to={mode === "login" ? "/register" : "/login"}>{mode === "login" ? "Create account" : "Sign in"}</Link></p></section></main>;
}

function ForgotPasswordPage() {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ message: string }>("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: form.get("email") }) });
      setNotice(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to request a reset"); }
    finally { setLoading(false); }
  }
  return <main className="auth-page"><Link className="brand auth-brand" to="/"><span className="brand-mark"><GraduationCap size={22}/></span>SkillBridge</Link><section className="auth-card"><span className="eyebrow">Account recovery</span><h1>Reset your password</h1>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}<form onSubmit={submit}><label>Email address<input name="email" type="email" required/></label><button className="button primary full" disabled={loading}>{loading ? "Please wait…" : "Send reset link"}</button></form><p className="auth-switch"><Link to="/login">Back to sign in</Link></p></section></main>;
}

function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenRef = useRef(searchParams.get("token"));
  const started = useRef(false);
  const [status, setStatus] = useState("Verifying your email…");
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenRef.current;
    navigate("/verify-email", { replace: true });
    if (!token) { setStatus(""); setError("This verification link is invalid or expired."); return; }
    api<{ message: string }>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then((result) => setStatus(result.message))
      .catch((reason: unknown) => { setStatus(""); setError(reason instanceof Error ? reason.message : "Unable to verify your email"); });
  }, [navigate]);
  return <main className="auth-page"><Link className="brand auth-brand" to="/"><span className="brand-mark"><GraduationCap size={22}/></span>SkillBridge</Link><section className="auth-card"><span className="eyebrow">Email verification</span><h1>Verify your address</h1>{status && <div className="alert success" role="status">{status}</div>}{error && <div className="alert error" role="alert">{error}</div>}<Link className="button primary full" to="/login">Continue to sign in</Link></section></main>;
}

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const token = searchParams.get("token");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== form.get("confirmPassword")) { setError("Passwords do not match."); return; }
    if (!token) { setError("This reset link is invalid or expired."); return; }
    navigate("/reset-password", { replace: true });
    setLoading(true);
    try {
      const result = await api<{ message: string }>("/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) });
      setNotice(result.message);
      window.setTimeout(() => navigate("/login"), 1200);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update your password"); }
    finally { setLoading(false); }
  }
  return <main className="auth-page"><Link className="brand auth-brand" to="/"><span className="brand-mark"><GraduationCap size={22}/></span>SkillBridge</Link><section className="auth-card"><span className="eyebrow">Account recovery</span><h1>Choose a new password</h1>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}<form onSubmit={submit}><label>New password<input name="password" type="password" required minLength={8}/></label><label>Confirm password<input name="confirmPassword" type="password" required minLength={8}/></label><button className="button primary full" disabled={loading}>{loading ? "Please wait…" : "Update password"}</button></form></section></main>;
}

function JobsPage() {
  const [q, setQ] = useState(""); const [jobType, setJobType] = useState(""); const [arrangement, setArrangement] = useState(""); const [location, setLocation] = useState("");
  const [experience,setExperience]=useState("");const [sort,setSort]=useState("newest");const [page,setPage]=useState(1);
  const params = new URLSearchParams({ pageSize: "12", page:String(page), sort, ...(q ? { q } : {}), ...(jobType ? { jobType } : {}), ...(arrangement ? { workArrangement: arrangement } : {}), ...(location ? { location } : {}), ...(experience ? { experienceLevel: experience } : {}) });
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["jobs", q, jobType, arrangement, location,experience,sort,page], queryFn: () => api<{items: Job[]; pagination: {page:number;total: number;totalPages:number}}>(`/api/jobs?${params}`) });
  return <><PublicNav/><main className="explore"><section className="explore-head"><span className="eyebrow">Explore opportunities</span><h1>Find work that moves you forward</h1><div className="searchbar"><Search size={18}/><input value={q} onChange={(e)=>{setQ(e.target.value);setPage(1);}} placeholder="Search title, company or skill"/></div></section><div className="explore-layout"><aside className="filters"><h3>Filters</h3><label>Location<input value={location} onChange={(e)=>{setLocation(e.target.value);setPage(1);}} placeholder="City or Remote"/></label><label>Job type<select value={jobType} onChange={(e)=>{setJobType(e.target.value);setPage(1);}}><option value="">All types</option><option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option><option value="INTERNSHIP">Internship</option><option value="CONTRACT">Contract</option></select></label><label>Work arrangement<select value={arrangement} onChange={(e)=>{setArrangement(e.target.value);setPage(1);}}><option value="">All arrangements</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ON_SITE">On-site</option></select></label><label>Experience<select value={experience} onChange={(e)=>{setExperience(e.target.value);setPage(1);}}><option value="">All levels</option><option value="ENTRY">Entry</option><option value="MID">Mid</option><option value="SENIOR">Senior</option></select></label></aside><section><div className="results-head"><strong>{data?.pagination.total ?? 0} opportunities</strong><label className="sort-control">Sort<select value={sort} onChange={(e)=>{setSort(e.target.value);setPage(1);}}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>{isLoading ? <SkeletonCards/> : isError ? <QueryError error={error} retry={refetch}/> : data?.items.length ? <><div className="job-grid">{data.items.map((job)=><JobCard key={job.id} job={job}/>)}</div><div className="pagination"><button className="button secondary" disabled={page<=1} onClick={()=>setPage(v=>v-1)}>Previous</button><span>Page {page} of {data.pagination.totalPages}</span><button className="button secondary" disabled={page>=data.pagination.totalPages} onClick={()=>setPage(v=>v+1)}>Next</button></div></> : <Empty text="No opportunities match these filters"/>}</section></div></main><Footer/></>;
}

function JobDetail() {
  const { id } = useParams(); const { user } = useAuth(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const { data: job, isLoading, error } = useQuery({ queryKey: ["job", id], queryFn: () => api<Job & { description:string; responsibilities:string[]; requirements:string[]; recruiter:{name:string;recruiterProfile?:{organisation?:string;description?:string}} }>(`/api/jobs/${id}`) });
  const apply = useMutation({ mutationFn: () => api(`/api/jobs/${id}/applications`, { method:"POST", body:"{}" }), onSuccess:()=>{queryClient.invalidateQueries({queryKey:["applications"]}); alert("Application submitted");} });
  const saved = useQuery({ queryKey:["saved"], queryFn:()=>api<{items:{jobId:string}[]}>("/api/saved-jobs"), enabled:user?.role==="STUDENT" });
  const isSaved=saved.data?.items.some((item)=>item.jobId===id)??false;
  const save = useMutation({ mutationFn: () => api(`/api/saved-jobs/${id}`, { method:isSaved?"DELETE":"POST" }), onSuccess:()=>queryClient.invalidateQueries({queryKey:["saved"]}) });
  if (isLoading) return <><PublicNav/><main className="detail"><div className="skeleton-block"/></main></>;
  if (error) return <><PublicNav/><main className="detail"><div className="alert error">{error instanceof Error ? error.message : "Listing unavailable"}</div></main></>;
  if (!job) return null;
  const isExpired=new Date(job.deadline)<new Date();
  return <><PublicNav/><main className="detail"><Link className="back-link" to="/jobs">← All opportunities</Link><div className="detail-layout"><article className="detail-main"><span className="tag">{job.jobType.replace("_"," ")}</span><h1>{job.title}</h1><p className="detail-org">{job.recruiter.recruiterProfile?.organisation ?? "Organisation"} · {job.location}</p><h2>About the role</h2><p>{job.description}</p><h2>Responsibilities</h2><ul>{job.responsibilities.map((item)=><li key={item}>{item}</li>)}</ul><h2>Requirements</h2><ul>{job.requirements.map((item)=><li key={item}>{item}</li>)}</ul><h2>Required skills</h2><div className="skill-list">{job.skills.map((skill)=><span key={skill}>{skill}</span>)}</div></article><aside className="apply-card"><strong>{job.location}</strong><small>{job.workArrangement.replace("_"," ")}</small><hr/><p>Application deadline<br/><strong>{new Date(job.deadline).toLocaleDateString()}</strong></p>{user?.role==="STUDENT"?<><button className="button primary full" onClick={()=>apply.mutate()} disabled={apply.isPending||isExpired}>{isExpired?"Applications closed":apply.isPending?"Submitting…":"Apply now"}</button>{apply.isError&&<p className="inline-error" role="alert">{apply.error.message}</p>}<button className="button secondary full" onClick={()=>save.mutate()} disabled={save.isPending}>{save.isPending?"Updating…":isSaved?"Remove saved opportunity":"Save opportunity"}</button>{save.isError&&<p className="inline-error" role="alert">{save.error.message}</p>}{saved.isError&&<p className="inline-error" role="alert">Unable to check saved opportunities.</p>}</>:user?<p role="status">Sign in with a student account to apply.</p>:<button className="button primary full" onClick={()=>navigate("/login")}>Sign in to apply</button>}</aside></div></main><Footer/></>;
}

function Protected({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading workspace…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={`/${user.role.toLowerCase()}/dashboard`} replace />;
  return <>{children}</>;
}

const sidebarItems: Record<Role, {label:string; icon:typeof LayoutDashboard; path:string}[]> = {
  STUDENT:[{label:"Dashboard",icon:LayoutDashboard,path:"/student/dashboard"},{label:"Profile",icon:UserRound,path:"/student/profile"},{label:"Resume",icon:FileText,path:"/student/resume"},{label:"Saved jobs",icon:Bookmark,path:"/student/saved-jobs"},{label:"Applications",icon:BriefcaseBusiness,path:"/student/applications"}],
  RECRUITER:[{label:"Dashboard",icon:LayoutDashboard,path:"/recruiter/dashboard"},{label:"Job listings",icon:BriefcaseBusiness,path:"/recruiter/jobs"},{label:"Applicants",icon:Users,path:"/recruiter/applicants"},{label:"Organisation",icon:Building2,path:"/recruiter/profile"}],
  ADMIN:[{label:"Dashboard",icon:LayoutDashboard,path:"/admin/dashboard"},{label:"Users",icon:Users,path:"/admin/users"},{label:"Listings",icon:BriefcaseBusiness,path:"/admin/jobs"},{label:"Audit log",icon:FileText,path:"/admin/audit"}],
};

function DashboardShell({ children, title }: { children: ReactNode; title: string }) {
  const { user, logout } = useAuth(); const location = useLocation(); const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = sidebarItems[user.role];
  const profilePath = user.role === "STUDENT" ? "/student/profile" : user.role === "RECRUITER" ? "/recruiter/profile" : "/admin/dashboard";
  return <div className="app-shell"><aside className={`sidebar ${open ? "open" : ""}`}><button className="sidebar-close" onClick={()=>setOpen(false)} aria-label="Close navigation"><X/></button><Link className="brand" to="/"><span className="brand-mark"><GraduationCap size={21}/></span>SkillBridge</Link><nav>{items.map(({label,icon:Icon,path})=><Link key={path} className={location.pathname===path?"active":""} to={path}><Icon size={18}/>{label}</Link>)}</nav><button className="logout" onClick={() => void logout().catch(() => window.alert("You were signed out on this device, but the server could not revoke the session."))}><LogOut size={18}/>Log out</button></aside>{open && <button className="sidebar-overlay" onClick={()=>setOpen(false)} aria-label="Close navigation"/>}<section className="workspace"><header className="dashboard-header"><button className="mobile-menu" onClick={()=>setOpen(true)} aria-label="Open navigation"><Menu/></button><div><div className="breadcrumb">Workspace / <strong>{title}</strong></div><h1>{title}</h1></div><div className="header-actions"><ThemeToggle/><NotificationMenu/><Link className="avatar" to={profilePath} aria-label="Open profile"><CircleUserRound size={20}/></Link></div></header><main className="dashboard-content">{children}</main></section></div>;
}

function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [actionError,setActionError]=useState("");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications", page],
    queryFn: () => api<{ items: { id: string; title: string; message: string; readAt: string | null; createdAt: string }[]; unreadCount: number; pagination: { page: number; totalPages: number } }>(`/api/notifications?page=${page}`),
    enabled: open,
  });
  const unread = query.data?.unreadCount ?? 0;
  async function markRead(id: string) {
    try { setActionError(""); await api(`/api/notifications/${id}/read`, { method: "PATCH" }); await queryClient.invalidateQueries({ queryKey: ["notifications"] }); }
    catch(reason) { setActionError(reason instanceof Error?reason.message:"Unable to mark notification as read"); }
  }
  return <div className="notification-control">
    <button className="icon-button notification-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Bell size={18}/>{unread > 0 && <span className="notification-count">{unread}</span>}</button>
    {open && <section className="notification-popover" aria-label="Notifications"><div className="panel-head"><strong>Notifications</strong><button className="icon-button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={16}/></button></div>{actionError&&<div className="alert error" role="alert">{actionError}</div>}{query.isLoading ? <p>Loading notifications…</p> : query.isError ? <QueryError error={query.error} retry={query.refetch}/> : query.data?.items.length ? <>{query.data.items.map((item) => <article className={`notification-item ${item.readAt ? "" : "unread"}`} key={item.id}><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString()}</small>{!item.readAt && <button className="button ghost" onClick={() => void markRead(item.id)}>Mark as read</button>}</article>)}<div className="page-controls"><button className="button ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Newer</button><span>Page {page} of {query.data.pagination.totalPages}</span><button className="button ghost" disabled={page >= query.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Older</button></div></> : <Empty text="You're all caught up"/>}</section>}
  </div>;
}

function StudentDashboard() {
  const { user } = useAuth();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey:["studentDashboard"], queryFn:()=>api<{applications:{total:number;counts:Record<string,number>;recent:Application[]};savedJobs:number;recommendations:Job[]}>("/api/student/dashboard") });
  if (isLoading) return <DashboardShell title="Dashboard"><div className="loading-card">Loading dashboard…</div></DashboardShell>;
  if (isError) return <DashboardShell title="Dashboard"><QueryError error={error} retry={refetch}/></DashboardShell>;
  return <DashboardShell title="Dashboard"><section className="welcome"><div><span>Good to see you</span><h2>Welcome back, {user?.name.split(" ")[0]}</h2><p>Here is what is happening with your career search.</p></div><Link className="button primary" to="/jobs">Find opportunities</Link></section><div className="metric-grid"><Metric label="Applications" value={data?.applications.total ?? 0} icon={BriefcaseBusiness}/><Metric label="Pending" value={(data?.applications.counts.APPLIED ?? 0)+(data?.applications.counts.UNDER_REVIEW ?? 0)} icon={Settings}/><Metric label="Shortlisted" value={data?.applications.counts.SHORTLISTED ?? 0} icon={Users}/><Metric label="Saved jobs" value={data?.savedJobs ?? 0} icon={Bookmark}/></div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><h3>Recent applications</h3><Link to="/student/applications">View all</Link></div>{data?.applications.recent.length ? data.applications.recent.slice(0,5).map((item)=><div className="activity-row" key={item.id}><span className="activity-icon"><BriefcaseBusiness size={17}/></span><div><strong>{item.job.title}</strong><small>{item.job.recruiter?.recruiterProfile?.organisation ?? "Organisation"} · {new Date(item.appliedAt).toLocaleDateString()}</small></div><Status status={item.status}/></div>) : <Empty text="No applications yet"/>}</section><section className="panel"><div className="panel-head"><h3>Recommended for you</h3></div>{data?.recommendations.length ? data.recommendations.slice(0,4).map((job)=><Link className="recommend-row" key={job.id} to={`/jobs/${job.id}`}><div><strong>{job.title}</strong><small>{job.location}</small></div><ChevronRight size={16}/></Link>) : <Empty text="Add skills to your profile for recommendations"/>}</section></div></DashboardShell>;
}

function Metric({label,value,icon:Icon}:{label:string;value:number;icon:typeof BriefcaseBusiness}) { return <article className="metric"><span><Icon size={19}/></span><div><small>{label}</small><strong>{value}</strong></div></article>; }
function Status({status}:{status:string}) { return <span className={`status status-${status.toLowerCase().replace("_","-")}`}>{status.replace("_"," ")}</span>; }
function Empty({text}:{text:string}) { return <div className="empty-state"><BriefcaseBusiness size={24}/><p>{text}</p></div>; }

function PageControls({page,totalPages,onPage}:{page:number;totalPages:number;onPage:(nextPage:number)=>void}) {
  if(totalPages<=1)return null;
  return <div className="pagination"><button className="button secondary" disabled={page<=1} onClick={()=>onPage(page-1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="button secondary" disabled={page>=totalPages} onClick={()=>onPage(page+1)}>Next</button></div>;
}

function ProfilePage() {
  const { data, refetch, isError, error, isLoading } = useQuery({ queryKey:["profile"], queryFn:()=>api<ProfileResponse>("/api/users/me/profile") });
  const [notice,setNotice]=useState<{type:"success"|"error";text:string}|null>(null);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries([...form.entries()].map(([k,v])=>[k,v === "" ? undefined : v]));
    payload.skills=String(payload.skills ?? "").split(",").map((v:string)=>v.trim()).filter(Boolean);
    try { await api("/api/users/me/profile",{method:"PATCH",body:JSON.stringify(payload)}); setNotice({type:"success",text:"Profile saved"}); await refetch(); }
    catch (reason) { setNotice({type:"error",text:reason instanceof Error?reason.message:"Unable to save profile"}); }
  }
  const profile=data?.studentProfile ?? {};
  if (isLoading) return <DashboardShell title="Profile"><div className="loading-card">Loading profile…</div></DashboardShell>;
  if (isError) return <DashboardShell title="Profile"><QueryError error={error} retry={refetch}/></DashboardShell>;
  return <DashboardShell title="Profile"><section className="panel profile-panel"><div className="profile-heading"><span className="profile-avatar"><UserRound/></span><div><h2>{data?.user.name ?? "Student"}</h2><p>{data?.user.email}</p></div></div>{notice&&<div className={`alert ${notice.type}`} role="status">{notice.text}</div>}<form className="form-grid" onSubmit={submit}><label>Full name<input name="name" defaultValue={data?.user.name ?? ""}/></label><label>Phone<input name="phone" defaultValue={profile.phone ?? ""}/></label><label>Location<input name="location" defaultValue={profile.location ?? ""}/></label><label>University<input name="university" defaultValue={profile.university ?? ""}/></label><label>Degree<input name="degree" defaultValue={profile.degree ?? ""}/></label><label>Branch<input name="branch" defaultValue={profile.branch ?? ""}/></label><label>Graduation year<input name="graduationYear" type="number" defaultValue={profile.graduationYear ?? ""}/></label><label>Skills<input name="skills" defaultValue={(profile.skills ?? []).join(", ")}/></label><label>LinkedIn URL<input name="linkedinUrl" type="url" defaultValue={profile.linkedinUrl ?? ""}/></label><label>GitHub URL<input name="githubUrl" type="url" defaultValue={profile.githubUrl ?? ""}/></label><label>Portfolio URL<input name="portfolioUrl" type="url" defaultValue={profile.portfolioUrl ?? ""}/></label><label className="span-two">Professional biography<textarea name="bio" defaultValue={profile.bio ?? ""}/></label><div className="span-two"><button className="button primary">Save profile</button></div></form></section></DashboardShell>;
}

function ResumePage() {
  const { data, refetch, isError, error, isLoading }=useQuery({queryKey:["resume"],queryFn:()=>api<ProfileResponse>("/api/users/me/profile")}); const [notice,setNotice]=useState<{type:"success"|"error";text:string}|null>(null);
  async function upload(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    try { await api("/api/users/me/resume",{method:"POST",body:form}); setNotice({type:"success",text:"Resume uploaded"}); await refetch(); }
    catch (reason) { setNotice({type:"error",text:reason instanceof Error?reason.message:"Unable to upload resume"}); }
  }
  async function remove(){try{await api("/api/users/me/resume",{method:"DELETE"});setNotice({type:"success",text:"Resume removed"});await refetch();}catch(reason){setNotice({type:"error",text:reason instanceof Error?reason.message:"Unable to remove resume"});}}
  const resume=data?.studentProfile;
  if (isLoading) return <DashboardShell title="Resume"><div className="loading-card">Loading resume details…</div></DashboardShell>;
  if (isError) return <DashboardShell title="Resume"><QueryError error={error} retry={refetch}/></DashboardShell>;
  return <DashboardShell title="Resume"><section className="panel resume-panel"><div className="resume-icon"><FileText/></div><div><h2>{resume?.resumeName ?? "No resume uploaded"}</h2>{resume?.resumeSize && <p>{(resume.resumeSize/1024/1024).toFixed(2)} MB · PDF</p>}<p>Upload a PDF resume up to 5 MB.</p></div>{notice&&<div className={`alert ${notice.type} span-two`} role="status">{notice.text}</div>}<form className="resume-actions" onSubmit={upload}><input name="resume" type="file" accept="application/pdf" required/><button className="button primary">{resume?.resumeName?"Replace resume":"Upload resume"}</button>{resume?.resumeName&&<button type="button" className="button danger" onClick={()=>void remove()}>Remove</button>}</form></section></DashboardShell>;
}

function SavedJobsPage() {
  const query=useQuery({queryKey:["saved"],queryFn:()=>api<{items:{id:string;jobId:string;job:Job}[]}>("/api/saved-jobs")}); const qc=useQueryClient();
  const [actionError,setActionError]=useState("");
  async function remove(jobId:string){try{setActionError("");await api(`/api/saved-jobs/${jobId}`,{method:"DELETE"});await qc.invalidateQueries({queryKey:["saved"]});}catch(reason){setActionError(reason instanceof Error?reason.message:"Unable to remove saved opportunity");}}
  return <DashboardShell title="Saved jobs"><section className="panel"><div className="panel-head"><h3>Saved opportunities</h3></div>{actionError&&<div className="alert error" role="alert">{actionError}</div>}{query.isLoading ? <div className="loading-card">Loading saved opportunities…</div> : query.isError ? <QueryError error={query.error} retry={query.refetch}/> : query.data?.items.length ? query.data.items.map((item)=><div className="table-row" key={item.id}><div><strong>{item.job.title}</strong><small>{item.job.location}</small></div><div className="row-actions"><Link className="button secondary" to={`/jobs/${item.jobId}`}>View</Link><button className="button ghost" onClick={()=>void remove(item.jobId)}>Remove</button></div></div>) : <Empty text="You have no saved opportunities"/>}</section></DashboardShell>;
}

function ApplicationsPage() {
  const [status,setStatus]=useState(""); const [q,setQ]=useState("");const [page,setPage]=useState(1);
  const params=new URLSearchParams({... (status?{status}:{}),...(q?{q}:{}),page:String(page)});
  const {data,refetch,isLoading,isError,error}=useQuery({queryKey:["applications",status,q,page],queryFn:()=>api<{items:Application[];pagination:{page:number;pageSize:number;total:number;totalPages:number}}>(`/api/applications/me?${params}`)});
  async function withdraw(id:string){if(confirm("Withdraw this application?")){try{await api(`/api/applications/${id}/withdraw`,{method:"PATCH"});await refetch();}catch(reason){window.alert(reason instanceof Error?reason.message:"Unable to withdraw application");}}}
  return <DashboardShell title="Applications"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>{setQ(e.target.value);setPage(1);}} placeholder="Search applications"/></label><select value={status} onChange={(e)=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{["APPLIED","UNDER_REVIEW","SHORTLISTED","INTERVIEW","OFFERED","REJECTED","WITHDRAWN"].map(v=><option key={v}>{v}</option>)}</select></div>{isLoading ? <div className="loading-card">Loading applications…</div> : isError ? <QueryError error={error} retry={refetch}/> : <><div className="applications-table"><div className="table-header"><span>Opportunity</span><span>Organisation</span><span>Applied</span><span>Status</span><span/></div>{data?.items.length ? data.items.map((item)=><div className="table-row" key={item.id}><div><strong>{item.job.title}</strong><small>{item.job.location}</small></div><span>{item.job.recruiter?.recruiterProfile?.organisation ?? "Organisation"}</span><span>{new Date(item.appliedAt).toLocaleDateString()}</span><Status status={item.status}/><button className="button ghost" disabled={["WITHDRAWN","REJECTED","OFFERED"].includes(item.status)} onClick={()=>withdraw(item.id)}>Withdraw</button></div>) : <Empty text="No applications match these filters"/>}</div><PageControls page={page} totalPages={data?.pagination.totalPages??0} onPage={setPage}/></>}</section></DashboardShell>;
}

function RecruiterDashboard() {
  const {data,isLoading,isError,error,refetch}=useQuery({queryKey:["recruiterDashboard"],queryFn:()=>api<{activeListings:number;totalApplications:number;underReview:number;shortlisted:number;recentApplications:Application[];listingPerformance:{id:string;title:string;status:string;applications:number}[]}>("/api/recruiter/dashboard")});
  if(isLoading)return <DashboardShell title="Dashboard"><div className="loading-card">Loading dashboard…</div></DashboardShell>;
  if(isError)return <DashboardShell title="Dashboard"><QueryError error={error} retry={refetch}/></DashboardShell>;
  if(!data)return <DashboardShell title="Dashboard"><div className="loading-card">Dashboard data is unavailable.</div></DashboardShell>;
  return <DashboardShell title="Dashboard"><section className="welcome recruiter-welcome"><div><span>Recruiter workspace</span><h2>Your hiring overview</h2><p>Track listings and candidate movement.</p></div><Link className="button primary" to="/recruiter/jobs">Manage listings</Link></section><div className="metric-grid"><Metric label="Active listings" value={data.activeListings} icon={BriefcaseBusiness}/><Metric label="Applications" value={data.totalApplications} icon={Users}/><Metric label="Under review" value={data.underReview} icon={Settings}/><Metric label="Shortlisted" value={data.shortlisted} icon={GraduationCap}/></div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><h3>Recent applicants</h3><Link to="/recruiter/applicants">View all</Link></div>{data.recentApplications.length?data.recentApplications.map((item)=><div className="activity-row" key={item.id}><span className="activity-icon"><UserRound size={17}/></span><div><strong>{item.student?.name}</strong><small>{item.job.title}</small></div><Status status={item.status}/></div>):<Empty text="No recent applications"/>}</section><section className="panel"><div className="panel-head"><h3>Listing performance</h3></div>{data.listingPerformance.map((item)=><div className="recommend-row" key={item.id}><div><strong>{item.title}</strong><small>{item.applications} applications</small></div><Status status={item.status}/></div>)}</section></div></DashboardShell>;
}

function RecruiterJobs() {
  const [show,setShow]=useState(false); const [message,setMessage]=useState("");const [actionError,setActionError]=useState("");
  const [page,setPage]=useState(1);const [q,setQ]=useState("");const [status,setStatus]=useState("");
  const [editing,setEditing]=useState<RecruiterJob|null>(null);
  const params=new URLSearchParams({page:String(page),...(q?{q}:{}),...(status?{status}:{})});
  const {data,refetch,isLoading,isError,error}=useQuery({queryKey:["recruiterJobs",q,status,page],queryFn:()=>api<{items:RecruiterJob[];pagination:{page:number;totalPages:number}}>(`/api/recruiter/jobs?${params}`)});
  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const payload={title:String(form.get("title")),description:String(form.get("description")),responsibilities:String(form.get("responsibilities")).split("\n").map(v=>v.trim()).filter(Boolean),requirements:String(form.get("requirements")).split("\n").map(v=>v.trim()).filter(Boolean),skills:String(form.get("skills")).split(",").map(v=>v.trim()).filter(Boolean),jobType:String(form.get("jobType")),workArrangement:String(form.get("workArrangement")),location:String(form.get("location")),experienceLevel:String(form.get("experienceLevel")),deadline:String(form.get("deadline")),status:String(form.get("status"))};
    await api(editing ? `/api/jobs/${editing.id}` : "/api/jobs",{method:editing?"PATCH":"POST",body:JSON.stringify(payload)}); setShow(false); setEditing(null); setMessage(editing?"Listing updated":"Listing created"); refetch();
  }
  async function close(job:RecruiterJob){await api(`/api/jobs/${job.id}`,{method:"PATCH",body:JSON.stringify({status:"CLOSED"})});refetch();}
  async function reopen(job:RecruiterJob){await api(`/api/jobs/${job.id}`,{method:"PATCH",body:JSON.stringify({status:"PUBLISHED"})});refetch();}
  async function remove(job:RecruiterJob){if(!window.confirm("Delete this draft listing?"))return;await api(`/api/jobs/${job.id}`,{method:"DELETE"});refetch();}
  function edit(job:RecruiterJob){setEditing(job);setShow(true);setMessage("");setActionError("");}
  return <DashboardShell title="Job listings"><section className="panel"><div className="panel-head"><h3>Manage listings</h3><button className="button primary" onClick={()=>{setEditing(null);setActionError("");setShow(true);}}>Create listing</button></div>{message&&<div className="alert success" role="status">{message}</div>}{actionError&&<div className="alert error" role="alert">{actionError}</div>}<div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>{setQ(e.target.value);setPage(1);}} placeholder="Search your listings"/></label><select value={status} onChange={(e)=>{setStatus(e.target.value);setPage(1);}} aria-label="Filter listings by status"><option value="">All statuses</option>{["DRAFT","PUBLISHED","CLOSED"].map((item)=><option key={item}>{item}</option>)}</select></div>{isLoading?<div className="loading-card">Loading listings…</div>:isError?<QueryError error={error} retry={refetch}/>:show&&<form className="form-grid listing-form" onSubmit={(event)=>void create(event).catch((reason:unknown)=>setActionError(reason instanceof Error?reason.message:"Unable to save listing"))}><label>Job title<input name="title" required defaultValue={editing?.title}/></label><label>Location<input name="location" required defaultValue={editing?.location}/></label><label>Job type<select name="jobType" defaultValue={editing?.jobType??"FULL_TIME"}><option value="FULL_TIME">Full time</option><option value="INTERNSHIP">Internship</option><option value="PART_TIME">Part time</option><option value="CONTRACT">Contract</option></select></label><label>Work arrangement<select name="workArrangement" defaultValue={editing?.workArrangement??"ON_SITE"}><option value="ON_SITE">On-site</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option></select></label><label>Experience<select name="experienceLevel" defaultValue={editing?.experienceLevel??"ENTRY"}><option value="ENTRY">Entry</option><option value="MID">Mid</option><option value="SENIOR">Senior</option></select></label><label>Status<select name="status" defaultValue={editing?.status??"DRAFT"}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="CLOSED">Closed</option></select></label><label>Deadline<input name="deadline" type="date" required defaultValue={editing?.deadline.slice(0,10)}/></label><label>Required skills<input name="skills" placeholder="React, TypeScript" defaultValue={editing?.skills.join(", ")}/></label><label className="span-two">Description<textarea name="description" required defaultValue={editing?.description}/></label><label>Responsibilities<textarea name="responsibilities" defaultValue={editing?.responsibilities.join("\n")}/></label><label>Requirements<textarea name="requirements" defaultValue={editing?.requirements.join("\n")}/></label><div className="span-two row-actions"><button className="button primary">{editing?"Update listing":"Save listing"}</button><button type="button" className="button secondary" onClick={()=>{setShow(false);setEditing(null);}}>Cancel</button></div></form>}{!isLoading&&!isError&&<><div className="listings-table">{data?.items.length?data.items.map((job)=><div className="table-row" key={job.id}><div><strong>{job.title}</strong><small>{job.location}</small></div><Status status={job.status??"DRAFT"}/><span>{job._count.applications} applicants</span><div className="row-actions"><button className="button ghost" onClick={()=>edit(job)}>Edit</button>{job.status==="PUBLISHED"?<button className="button ghost" onClick={()=>void close(job).catch((e:unknown)=>setActionError(e instanceof Error?e.message:"Unable to close listing"))}>Close</button>:job.status==="DRAFT"?<button className="button danger" onClick={()=>void remove(job).catch((e:unknown)=>setActionError(e instanceof Error?e.message:"Unable to delete draft"))}>Delete draft</button>:<button className="button secondary" onClick={()=>void reopen(job).catch((e:unknown)=>setActionError(e instanceof Error?e.message:"Unable to reopen listing"))}>Reopen</button>}</div></div>):<Empty text="No listings match these filters"/>}</div><PageControls page={page} totalPages={data?.pagination.totalPages??0} onPage={setPage}/></>}</section></DashboardShell>;
}

function RecruiterApplicants() {
  const [q,setQ]=useState(""); const [status,setStatus]=useState("");const [page,setPage]=useState(1);const params=new URLSearchParams({...q?{q}:{},page:String(page)});
  if(status)params.set("status",status);
  const {data,refetch,isLoading,isError,error}=useQuery({queryKey:["applicants",q,status,page],queryFn:()=>api<{items:Application[];pagination:{page:number;totalPages:number}}>(`/api/recruiter/applicants?${params}`)});
  async function update(id:string,nextStatus:string){await api(`/api/applications/${id}/status`,{method:"PATCH",body:JSON.stringify({status:nextStatus})});await refetch();}
  return <DashboardShell title="Applicants"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>{setQ(e.target.value);setPage(1);}} placeholder="Search candidates or roles"/></label><select value={status} onChange={(e)=>{setStatus(e.target.value);setPage(1);}} aria-label="Filter applicants by status"><option value="">All statuses</option>{["APPLIED","UNDER_REVIEW","SHORTLISTED","INTERVIEW","OFFERED","REJECTED","WITHDRAWN"].map((value)=><option key={value}>{value}</option>)}</select></div>{isLoading?<div className="loading-card">Loading applicants…</div>:isError?<QueryError error={error} retry={refetch}/>:data?.items.length?<>{data.items.map((item)=><div className="table-row applicant-row" key={item.id}><div><strong>{item.student?.name}</strong><small>{item.student?.email} · {item.job.title}</small>{item.student?.studentProfile?.resumeName&&<a className="resume-link" href={`/api/recruiter/applications/${item.id}/resume`} target="_blank" rel="noreferrer">View resume (PDF)</a>}</div><Status status={item.status}/><select value={item.status} onChange={(e)=>void update(item.id,e.target.value).catch((reason:unknown)=>window.alert(reason instanceof Error?reason.message:"Unable to update application"))} aria-label={`Update status for ${item.student?.name}`}>{allowedRecruiterStatuses(item.status).map((value)=><option key={value}>{value}</option>)}</select></div>)}<PageControls page={page} totalPages={data.pagination.totalPages} onPage={setPage}/></>:<Empty text="No applicants match these filters"/>}</section></DashboardShell>;
}

function allowedRecruiterStatuses(current: string) {
  const transitions: Record<string, string[]> = {
    APPLIED: ["UNDER_REVIEW", "REJECTED"],
    UNDER_REVIEW: ["SHORTLISTED", "INTERVIEW", "REJECTED"],
    SHORTLISTED: ["INTERVIEW", "OFFERED", "REJECTED"],
    INTERVIEW: ["OFFERED", "REJECTED"],
  };
  return [current, ...(transitions[current] ?? [])];
}

function RecruiterProfilePage() {
  const {data,refetch,isLoading,isError,error}=useQuery({queryKey:["recruiterProfile"],queryFn:()=>api<ProfileResponse>("/api/users/me/profile")});
  const [notice,setNotice]=useState<{type:"success"|"error";text:string}|null>(null);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault(); const form=new FormData(event.currentTarget); try{await api("/api/users/me/recruiter-profile",{method:"PATCH",body:JSON.stringify(Object.fromEntries(form.entries()))});setNotice({type:"success",text:"Organisation profile saved"});await refetch();}catch(e){setNotice({type:"error",text:e instanceof Error?e.message:"Unable to save profile"});}}
  const profile=data?.recruiterProfile ?? {};
  if(isLoading)return <DashboardShell title="Organisation"><div className="loading-card">Loading organisation…</div></DashboardShell>;
  if(isError)return <DashboardShell title="Organisation"><QueryError error={error} retry={refetch}/></DashboardShell>;
  return <DashboardShell title="Organisation"><section className="panel profile-panel">{notice&&<div className={`alert ${notice.type}`} role={notice.type==="error"?"alert":"status"}>{notice.text}</div>}<form className="form-grid" onSubmit={submit}><label>Organisation name<input name="organisation" defaultValue={profile.organisation ?? ""}/></label><label>Designation<input name="designation" defaultValue={profile.designation ?? ""}/></label><label>Website<input name="website" type="url" defaultValue={profile.website ?? ""}/></label><label>Industry<input name="industry" defaultValue={profile.industry ?? ""}/></label><label>Location<input name="location" defaultValue={profile.location ?? ""}/></label><label>Organisation logo URL<input name="organisationLogo" type="url" defaultValue={profile.organisationLogo ?? ""}/></label><label className="span-two">Organisation description<textarea name="description" defaultValue={profile.description ?? ""}/></label><div className="span-two"><button className="button primary">Save organisation</button></div></form></section></DashboardShell>;
}

function AdminDashboard() {
  const {data,isLoading,isError,error,refetch}=useQuery({queryKey:["adminDashboard"],queryFn:()=>api<{totalUsers:number;totalStudents:number;totalRecruiters:number;totalListings:number;publishedListings:number;totalApplications:number}>("/api/admin/dashboard")});
  if(isLoading)return <DashboardShell title="Dashboard"><div className="loading-card">Loading dashboard…</div></DashboardShell>;
  if(isError)return <DashboardShell title="Dashboard"><QueryError error={error} retry={refetch}/></DashboardShell>;
  if(!data)return <DashboardShell title="Dashboard"><div className="loading-card">Dashboard data is unavailable.</div></DashboardShell>;
  return <DashboardShell title="Dashboard"><section className="welcome admin-welcome"><div><span>Administration</span><h2>Platform overview</h2><p>Monitor users, listings and application activity.</p></div></section><div className="metric-grid"><Metric label="Total users" value={data.totalUsers} icon={Users}/><Metric label="Students" value={data.totalStudents} icon={GraduationCap}/><Metric label="Recruiters" value={data.totalRecruiters} icon={Building2}/><Metric label="Listings" value={data.totalListings} icon={BriefcaseBusiness}/><Metric label="Published" value={data.publishedListings} icon={Search}/><Metric label="Applications" value={data.totalApplications} icon={FileText}/></div></DashboardShell>;
}

function AdminUsers() {
  const [q,setQ]=useState(""); const [role,setRole]=useState("");const [page,setPage]=useState(1);const params=new URLSearchParams({...q?{q}:{},page:String(page)});
  if(role)params.set("role",role);
  const {data,refetch,isLoading,isError,error}=useQuery({queryKey:["adminUsers",q,role,page],queryFn:()=>api<{items:AdminUser[];pagination:{page:number;totalPages:number}}>(`/api/admin/users?${params}`)});
  async function status(user:AdminUser){await api(`/api/admin/users/${user.id}/status`,{method:"PATCH",body:JSON.stringify({accountStatus:user.accountStatus==="ACTIVE"?"SUSPENDED":"ACTIVE"})});await refetch();}
  return <DashboardShell title="Users"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>{setQ(e.target.value);setPage(1);}} placeholder="Search users"/></label><select value={role} onChange={(e)=>{setRole(e.target.value);setPage(1);}} aria-label="Filter users by role"><option value="">All roles</option>{["STUDENT","RECRUITER","ADMIN"].map((item)=><option key={item}>{item}</option>)}</select></div>{isLoading?<div className="loading-card">Loading users…</div>:isError?<QueryError error={error} retry={refetch}/>:data?.items.length?<>{data.items.map((user)=><div className="table-row" key={user.id}><div><strong>{user.name}</strong><small>{user.email}</small></div><span>{user.role}</span><Status status={user.accountStatus}/><button className="button ghost" onClick={()=>void status(user).catch((e:unknown)=>window.alert(e instanceof Error?e.message:"Unable to update account"))}>{user.accountStatus==="ACTIVE"?"Suspend":"Reactivate"}</button></div>)}<PageControls page={page} totalPages={data.pagination.totalPages} onPage={setPage}/></>:<Empty text="No users match these filters"/>}</section></DashboardShell>;
}

function AdminJobs() {
  const [q,setQ]=useState(""); const [status,setStatus]=useState("");const [page,setPage]=useState(1); const params=new URLSearchParams({...q?{q}:{},page:String(page)});
  if(status)params.set("status",status);
  const {data,refetch,isLoading,isError,error}=useQuery({queryKey:["adminJobs",q,status,page],queryFn:()=>api<{items:AdminJob[];pagination:{page:number;totalPages:number}}>(`/api/admin/jobs?${params}`)});
  async function moderate(job:AdminJob,nextStatus:"PUBLISHED"|"CLOSED"){await api(`/api/admin/jobs/${job.id}/moderation`,{method:"PATCH",body:JSON.stringify({status:nextStatus,reason:"Moderation action from admin dashboard"})});await refetch();}
  return <DashboardShell title="Listings"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>{setQ(e.target.value);setPage(1);}} placeholder="Search listings"/></label><select value={status} onChange={(e)=>{setStatus(e.target.value);setPage(1);}} aria-label="Filter listings by status"><option value="">All statuses</option>{["DRAFT","PUBLISHED","CLOSED"].map((item)=><option key={item}>{item}</option>)}</select></div>{isLoading?<div className="loading-card">Loading listings…</div>:isError?<QueryError error={error} retry={refetch}/>:data?.items.length?<>{data.items.map((job)=><div className="table-row" key={job.id}><div><strong>{job.title}</strong><small>{job.recruiter?.recruiterProfile?.organisation??"Organisation"} · {job.location}</small></div><Status status={job.status??"DRAFT"}/><div className="row-actions">{job.status==="CLOSED"?<button className="button secondary" onClick={()=>void moderate(job,"PUBLISHED").catch((e:unknown)=>window.alert(e instanceof Error?e.message:"Unable to publish listing"))}>Publish</button>:<button className="button danger" onClick={()=>void moderate(job,"CLOSED").catch((e:unknown)=>window.alert(e instanceof Error?e.message:"Unable to close listing"))}>Close</button>}</div></div>)}<PageControls page={page} totalPages={data.pagination.totalPages} onPage={setPage}/></>:<Empty text="No listings match these filters"/>}</section></DashboardShell>;
}

function AdminAudit() {
  const [page,setPage]=useState(1);
  const {data,refetch,isLoading,isError,error}=useQuery({queryKey:["adminAudit",page],queryFn:()=>api<{items:{id:string;action:string;entityType:string;entityId:string;metadata:Record<string,unknown>;createdAt:string;actor:{name:string;email:string}}[];pagination:{page:number;total:number;totalPages:number}}>(`/api/admin/audit-logs?page=${page}`)});
  return <DashboardShell title="Audit log"><section className="panel"><div className="panel-head"><h3>Administrative activity</h3><span>{data?.pagination.total??0} records</span></div>{isLoading?<div className="loading-card">Loading audit records…</div>:isError?<QueryError error={error} retry={refetch}/>:data?.items.length?<>{data.items.map((item)=><article className="audit-row" key={item.id}><div><strong>{item.action.replaceAll("_"," ")}</strong><small>{item.entityType} · {item.entityId}</small><small>By {item.actor.name} ({item.actor.email})</small></div><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></article>)}<PageControls page={page} totalPages={data.pagination.totalPages} onPage={setPage}/></>:<Empty text="No administrative activity recorded"/>}</section></DashboardShell>;
}

export default function App() {
  return <AuthProvider><Routes>
    <Route path="/" element={<Landing/>}/>
    <Route path="/jobs" element={<JobsPage/>}/>
    <Route path="/jobs/:id" element={<JobDetail/>}/>
    <Route path="/login" element={<AuthPage mode="login"/>}/>
    <Route path="/register" element={<AuthPage mode="register"/>}/>
    <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
    <Route path="/verify-email" element={<VerifyEmailPage/>}/>
    <Route path="/reset-password" element={<ResetPasswordPage/>}/>
    <Route path="/student/dashboard" element={<Protected role="STUDENT"><StudentDashboard/></Protected>}/>
    <Route path="/student/profile" element={<Protected role="STUDENT"><ProfilePage/></Protected>}/>
    <Route path="/student/resume" element={<Protected role="STUDENT"><ResumePage/></Protected>}/>
    <Route path="/student/saved-jobs" element={<Protected role="STUDENT"><SavedJobsPage/></Protected>}/>
    <Route path="/student/applications" element={<Protected role="STUDENT"><ApplicationsPage/></Protected>}/>
    <Route path="/recruiter/dashboard" element={<Protected role="RECRUITER"><RecruiterDashboard/></Protected>}/>
    <Route path="/recruiter/jobs" element={<Protected role="RECRUITER"><RecruiterJobs/></Protected>}/>
    <Route path="/recruiter/applicants" element={<Protected role="RECRUITER"><RecruiterApplicants/></Protected>}/>
    <Route path="/recruiter/profile" element={<Protected role="RECRUITER"><RecruiterProfilePage/></Protected>}/>
    <Route path="/admin/dashboard" element={<Protected role="ADMIN"><AdminDashboard/></Protected>}/>
    <Route path="/admin/users" element={<Protected role="ADMIN"><AdminUsers/></Protected>}/>
    <Route path="/admin/jobs" element={<Protected role="ADMIN"><AdminJobs/></Protected>}/>
    <Route path="/admin/audit" element={<Protected role="ADMIN"><AdminAudit/></Protected>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></AuthProvider>;
}
