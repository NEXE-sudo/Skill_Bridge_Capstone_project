import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BriefcaseBusiness, Building2, ChevronRight, CircleUserRound, GraduationCap, LayoutDashboard, LogOut, Moon, Search, Sun, UserRound, Users, Bookmark, FileText, Settings, Menu, X } from "lucide-react";
import { api, clearToken, getToken, setToken, type Role, type User } from "./api";

const AuthContext = createContext<{ user: User | null; login: (email: string, password: string) => Promise<User>; register: (data: { name: string; email: string; password: string; role: "STUDENT" | "RECRUITER" }) => Promise<User>; logout: () => void; loading: boolean }>({ user: null, login: async () => { throw new Error("Unavailable"); }, register: async () => { throw new Error("Unavailable"); }, logout: () => {}, loading: true });

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api<User & { accountStatus: string }>("/api/auth/me").then(setUser).catch(clearToken).finally(() => setLoading(false));
  }, []);
  async function login(email: string, password: string) {
    const data = await api<{ user: User; token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    setToken(data.token); setUser(data.user); return data.user;
  }
  async function register(payload: { name: string; email: string; password: string; role: "STUDENT" | "RECRUITER" }) {
    const data = await api<{ user: User; token: string }>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
    setToken(data.token); setUser(data.user); return data.user;
  }
  function logout() { clearToken(); setUser(null); }
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
  return <header className="public-nav"><Link className="brand" to="/"><span className="brand-mark"><GraduationCap size={22}/></span>SkillBridge</Link><nav><Link to="/jobs">Explore jobs</Link>{user ? <><Link to={`/${user.role.toLowerCase()}/dashboard`}>Dashboard</Link><button className="button ghost" onClick={logout}>Log out</button></> : <><Link to="/login">Log in</Link><Link className="button primary" to="/register">Get started</Link></>}</nav></header>;
}

function Landing() {
  const { data } = useQuery({ queryKey: ["landingJobs"], queryFn: () => api<{items: Job[]}>("/api/jobs?pageSize=3") });
  return <><PublicNav/><main>
    <section className="hero"><div><span className="eyebrow">Built for your next chapter</span><h1>Turn your skills into a <em>career</em>.</h1><p>Discover focused opportunities, build a professional profile, and track every application in one place.</p><div className="hero-actions"><Link className="button primary large" to="/jobs">Explore opportunities <ChevronRight size={18}/></Link><Link className="button secondary large" to="/register">Create account</Link></div></div><div className="hero-visual"><div className="floating-card"><span className="status-dot"/>Profile ready <strong>82%</strong><div className="progress"><i/></div></div><div className="match-card"><span>Recommended match</span><strong>Frontend Developer</strong><small>NovaTech Labs · Bengaluru</small></div></div></section>
    <section className="featured"><div className="section-heading"><div><span className="eyebrow">Fresh opportunities</span><h2>Featured jobs</h2></div><Link to="/jobs">View all <ChevronRight size={16}/></Link></div><div className="job-grid">{data?.items.map((job) => <JobCard key={job.id} job={job}/>)}</div></section>
    <section className="how"><span className="eyebrow">How it works</span><h2>Three steps to move forward</h2><div className="steps"><article><span>01</span><h3>Build your profile</h3><p>Highlight skills, education and the experience that makes you stand out.</p></article><article><span>02</span><h3>Find the right fit</h3><p>Search curated internships and jobs with useful, practical filters.</p></article><article><span>03</span><h3>Track your progress</h3><p>Manage applications and status updates from a single clear workspace.</p></article></div></section>
    <section className="audiences"><article><GraduationCap/><h3>For students</h3><p>One organised place for opportunities, applications and career growth.</p></article><article><Building2/><h3>For recruiters</h3><p>Publish listings and evaluate candidates with efficient applicant tools.</p></article></section>
  </main><Footer/></>;
}

function Footer() { return <footer className="footer"><Link className="brand" to="/"><span className="brand-mark"><GraduationCap size={20}/></span>SkillBridge</Link><p>Build skills. Find opportunities. Grow your career.</p><div><Link to="/jobs">Jobs</Link><Link to="/login">Sign in</Link></div></footer>; }

type Job = { id: string; title: string; location: string; jobType: string; workArrangement: string; skills: string[]; salaryMin?: number; salaryMax?: number; deadline: string; recruiter?: { recruiterProfile?: { organisation?: string } } };
function JobCard({ job }: { job: Job }) {
  return <article className="job-card"><div className="job-card-top"><span className="company-logo"><Building2 size={20}/></span><Bookmark size={18}/></div><div className="tag-row"><span>{job.jobType.replace("_"," ")}</span><span>{job.workArrangement.replace("_"," ")}</span></div><h3>{job.title}</h3><p>{job.recruiter?.recruiterProfile?.organisation ?? "Organisation"}</p><small>{job.location}</small><Link className="card-link" to={`/jobs/${job.id}`}>View opportunity <ChevronRight size={16}/></Link></article>;
}

function AuthPage({ mode }: { mode: "login"|"register" }) {
  const { login, register } = useAuth(); const navigate = useNavigate();
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const user = mode === "login" ? await login(String(form.get("email")), String(form.get("password"))) : await register({ name: String(form.get("name")), email: String(form.get("email")), password: String(form.get("password")), role: String(form.get("role")) as "STUDENT"|"RECRUITER" });
      navigate(`/${user.role.toLowerCase()}/dashboard`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to continue"); } finally { setLoading(false); }
  }
  return <main className="auth-page"><Link className="brand auth-brand" to="/"><span className="brand-mark"><GraduationCap size={22}/></span>SkillBridge</Link><section className="auth-card"><span className="eyebrow">{mode === "login" ? "Welcome back" : "Join SkillBridge"}</span><h1>{mode === "login" ? "Sign in to your workspace" : "Create your account"}</h1>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}>{mode === "register" && <label>Full name<input name="name" required minLength={2}/></label>}<label>Email address<input name="email" type="email" required/></label><label>Password<input name="password" type="password" required minLength={8}/></label>{mode === "register" && <label>I am a<select name="role"><option value="STUDENT">Student</option><option value="RECRUITER">Recruiter</option></select></label>}<button className="button primary full" disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button></form><p className="auth-switch">{mode === "login" ? "New to SkillBridge?" : "Already have an account?"} <Link to={mode === "login" ? "/register" : "/login"}>{mode === "login" ? "Create account" : "Sign in"}</Link></p></section></main>;
}

function JobsPage() {
  const [q, setQ] = useState(""); const [jobType, setJobType] = useState(""); const [arrangement, setArrangement] = useState(""); const [location, setLocation] = useState("");
  const params = new URLSearchParams({ pageSize: "12", ...(q ? { q } : {}), ...(jobType ? { jobType } : {}), ...(arrangement ? { workArrangement: arrangement } : {}), ...(location ? { location } : {}) });
  const { data, isLoading } = useQuery({ queryKey: ["jobs", q, jobType, arrangement, location], queryFn: () => api<{items: Job[]; pagination: {total: number}}>(`/api/jobs?${params}`) });
  return <><PublicNav/><main className="explore"><section className="explore-head"><span className="eyebrow">Explore opportunities</span><h1>Find work that moves you forward</h1><div className="searchbar"><Search size={18}/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search title, company or skill"/></div></section><div className="explore-layout"><aside className="filters"><h3>Filters</h3><label>Location<input value={location} onChange={(e)=>setLocation(e.target.value)} placeholder="City or Remote"/></label><label>Job type<select value={jobType} onChange={(e)=>setJobType(e.target.value)}><option value="">All types</option><option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option><option value="INTERNSHIP">Internship</option><option value="CONTRACT">Contract</option></select></label><label>Work arrangement<select value={arrangement} onChange={(e)=>setArrangement(e.target.value)}><option value="">All arrangements</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ON_SITE">On-site</option></select></label></aside><section><div className="results-head"><strong>{data?.pagination.total ?? 0} opportunities</strong></div>{isLoading ? <div className="skeleton-grid"><i/><i/><i/></div> : <div className="job-grid">{data?.items.map((job)=><JobCard key={job.id} job={job}/>)}</div>}</section></div></main><Footer/></>;
}

function JobDetail() {
  const { id } = useParams(); const { user } = useAuth(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const { data: job, isLoading, error } = useQuery({ queryKey: ["job", id], queryFn: () => api<Job & { description:string; responsibilities:string[]; requirements:string[]; recruiter:{name:string;recruiterProfile?:{organisation?:string;description?:string}} }>(`/api/jobs/${id}`) });
  const apply = useMutation({ mutationFn: () => api(`/api/jobs/${id}/applications`, { method:"POST", body:"{}" }), onSuccess:()=>{queryClient.invalidateQueries({queryKey:["applications"]}); alert("Application submitted");} });
  const save = useMutation({ mutationFn: () => api(`/api/saved-jobs/${id}`, { method:"POST" }) });
  if (isLoading) return <><PublicNav/><main className="detail"><div className="skeleton-block"/></main></>;
  if (error) return <><PublicNav/><main className="detail"><div className="alert error">{error instanceof Error ? error.message : "Listing unavailable"}</div></main></>;
  if (!job) return null;
  return <><PublicNav/><main className="detail"><Link className="back-link" to="/jobs">← All opportunities</Link><div className="detail-layout"><article className="detail-main"><span className="tag">{job.jobType.replace("_"," ")}</span><h1>{job.title}</h1><p className="detail-org">{job.recruiter.recruiterProfile?.organisation ?? "Organisation"} · {job.location}</p><h2>About the role</h2><p>{job.description}</p><h2>Responsibilities</h2><ul>{job.responsibilities.map((item)=><li key={item}>{item}</li>)}</ul><h2>Requirements</h2><ul>{job.requirements.map((item)=><li key={item}>{item}</li>)}</ul><h2>Required skills</h2><div className="skill-list">{job.skills.map((skill)=><span key={skill}>{skill}</span>)}</div></article><aside className="apply-card"><strong>{job.location}</strong><small>{job.workArrangement.replace("_"," ")}</small><hr/><p>Application deadline<br/><strong>{new Date(job.deadline).toLocaleDateString()}</strong></p>{user?.role === "STUDENT" ? <><button className="button primary full" onClick={()=>apply.mutate()} disabled={apply.isPending}>{apply.isPending ? "Submitting…" : "Apply now"}</button><button className="button secondary full" onClick={()=>save.mutate()}>{save.isSuccess ? "Saved" : "Save opportunity"}</button></> : <button className="button primary full" onClick={()=>navigate("/login")}>Sign in to apply</button>}</aside></div></main><Footer/></>;
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
  ADMIN:[{label:"Dashboard",icon:LayoutDashboard,path:"/admin/dashboard"},{label:"Users",icon:Users,path:"/admin/users"},{label:"Listings",icon:BriefcaseBusiness,path:"/admin/jobs"}],
};

function DashboardShell({ children, title }: { children: ReactNode; title: string }) {
  const { user, logout } = useAuth(); const location = useLocation(); const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = sidebarItems[user.role];
  return <div className="app-shell"><aside className={`sidebar ${open ? "open" : ""}`}><button className="sidebar-close" onClick={()=>setOpen(false)} aria-label="Close navigation"><X/></button><Link className="brand" to="/"><span className="brand-mark"><GraduationCap size={21}/></span>SkillBridge</Link><nav>{items.map(({label,icon:Icon,path})=><Link key={path} className={location.pathname===path?"active":""} to={path}><Icon size={18}/>{label}</Link>)}</nav><button className="logout" onClick={logout}><LogOut size={18}/>Log out</button></aside>{open && <button className="sidebar-overlay" onClick={()=>setOpen(false)} aria-label="Close navigation"/>}<section className="workspace"><header className="dashboard-header"><button className="mobile-menu" onClick={()=>setOpen(true)} aria-label="Open navigation"><Menu/></button><div><div className="breadcrumb">Workspace / <strong>{title}</strong></div><h1>{title}</h1></div><div className="header-actions"><ThemeToggle/><button className="icon-button" aria-label="Notifications"><Bell size={18}/></button><button className="avatar" aria-label="User menu"><CircleUserRound size={20}/></button></div></header><main className="dashboard-content">{children}</main></section></div>;
}

function StudentDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey:["studentDashboard"], queryFn:()=>api<{applications:{total:number;counts:Record<string,number>;recent:any[]};savedJobs:number;recommendations:Job[]}>("/api/student/dashboard") });
  if (isLoading) return <DashboardShell title="Dashboard"><div className="loading-card">Loading dashboard…</div></DashboardShell>;
  return <DashboardShell title="Dashboard"><section className="welcome"><div><span>Good to see you</span><h2>Welcome back, {user?.name.split(" ")[0]}</h2><p>Here is what is happening with your career search.</p></div><Link className="button primary" to="/jobs">Find opportunities</Link></section><div className="metric-grid"><Metric label="Applications" value={data?.applications.total ?? 0} icon={BriefcaseBusiness}/><Metric label="Pending" value={(data?.applications.counts.APPLIED ?? 0)+(data?.applications.counts.UNDER_REVIEW ?? 0)} icon={Settings}/><Metric label="Shortlisted" value={data?.applications.counts.SHORTLISTED ?? 0} icon={Users}/><Metric label="Saved jobs" value={data?.savedJobs ?? 0} icon={Bookmark}/></div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><h3>Recent applications</h3><Link to="/student/applications">View all</Link></div>{data?.applications.recent.length ? data.applications.recent.slice(0,5).map((item:any)=><div className="activity-row" key={item.id}><span className="activity-icon"><BriefcaseBusiness size={17}/></span><div><strong>{item.job.title}</strong><small>{item.job.recruiter?.recruiterProfile?.organisation ?? "Organisation"} · {new Date(item.appliedAt).toLocaleDateString()}</small></div><Status status={item.status}/></div>) : <Empty text="No applications yet"/>}</section><section className="panel"><div className="panel-head"><h3>Recommended for you</h3></div>{data?.recommendations.length ? data.recommendations.slice(0,4).map((job)=><Link className="recommend-row" key={job.id} to={`/jobs/${job.id}`}><div><strong>{job.title}</strong><small>{job.location}</small></div><ChevronRight size={16}/></Link>) : <Empty text="Add skills to your profile for recommendations"/>}</section></div></DashboardShell>;
}

function Metric({label,value,icon:Icon}:{label:string;value:number;icon:typeof BriefcaseBusiness}) { return <article className="metric"><span><Icon size={19}/></span><div><small>{label}</small><strong>{value}</strong></div></article>; }
function Status({status}:{status:string}) { return <span className={`status status-${status.toLowerCase().replace("_","-")}`}>{status.replace("_"," ")}</span>; }
function Empty({text}:{text:string}) { return <div className="empty-state"><BriefcaseBusiness size={24}/><p>{text}</p></div>; }

function ProfilePage() {
  const { data, refetch } = useQuery({ queryKey:["profile"], queryFn:()=>api<any>("/api/users/me/profile") });
  const [message,setMessage]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries([...form.entries()].map(([k,v])=>[k,v === "" ? undefined : v]));
    payload.skills=String(payload.skills ?? "").split(",").map((v:string)=>v.trim()).filter(Boolean);
    await api("/api/users/me/profile",{method:"PATCH",body:JSON.stringify(payload)}); setMessage("Profile saved"); refetch();
  }
  const profile=data?.studentProfile ?? {};
  return <DashboardShell title="Profile"><section className="panel profile-panel"><div className="profile-heading"><span className="profile-avatar"><UserRound/></span><div><h2>{data?.user.name ?? "Student"}</h2><p>{data?.user.email}</p></div></div>{message && <div className="alert success">{message}</div>}<form className="form-grid" onSubmit={submit}><label>Full name<input name="name" defaultValue={data?.user.name}/></label><label>Phone<input name="phone" defaultValue={profile.phone}/></label><label>Location<input name="location" defaultValue={profile.location}/></label><label>University<input name="university" defaultValue={profile.university}/></label><label>Degree<input name="degree" defaultValue={profile.degree}/></label><label>Branch<input name="branch" defaultValue={profile.branch}/></label><label>Graduation year<input name="graduationYear" type="number" defaultValue={profile.graduationYear}/></label><label>Skills<input name="skills" defaultValue={(profile.skills ?? []).join(", ")}/></label><label>LinkedIn URL<input name="linkedinUrl" type="url" defaultValue={profile.linkedinUrl}/></label><label>GitHub URL<input name="githubUrl" type="url" defaultValue={profile.githubUrl}/></label><label>Portfolio URL<input name="portfolioUrl" type="url" defaultValue={profile.portfolioUrl}/></label><label className="span-two">Professional biography<textarea name="bio" defaultValue={profile.bio}/></label><div className="span-two"><button className="button primary">Save profile</button></div></form></section></DashboardShell>;
}

function ResumePage() {
  const { data, refetch }=useQuery({queryKey:["resume"],queryFn:()=>api<any>("/api/users/me/profile")}); const [message,setMessage]=useState("");
  async function upload(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget); const token=getToken();
    const response=await fetch("/api/users/me/resume",{method:"POST",headers:token?{Authorization:`Bearer ${token}`}:{},body:form});
    const body=await response.json(); if(!response.ok) throw new Error(body.error?.message??"Upload failed"); setMessage("Resume uploaded"); refetch();
  }
  async function remove(){await api("/api/users/me/resume",{method:"DELETE"}); setMessage("Resume removed"); refetch();}
  const resume=data?.studentProfile;
  return <DashboardShell title="Resume"><section className="panel resume-panel"><div className="resume-icon"><FileText/></div><div><h2>{resume?.resumeName ?? "No resume uploaded"}</h2>{resume?.resumeSize && <p>{(resume.resumeSize/1024/1024).toFixed(2)} MB · PDF</p>}<p>Upload a PDF resume up to 5 MB.</p></div>{message&&<div className="alert success span-two">{message}</div>}<form className="resume-actions" onSubmit={upload}><input name="resume" type="file" accept="application/pdf" required/><button className="button primary">{resume?.resumeName?"Replace resume":"Upload resume"}</button>{resume?.resumeName&&<button type="button" className="button danger" onClick={remove}>Remove</button>}</form></section></DashboardShell>;
}

function SavedJobsPage() {
  const query=useQuery({queryKey:["saved"],queryFn:()=>api<{items:any[]}>("/api/saved-jobs")}); const qc=useQueryClient();
  async function remove(jobId:string){await api(`/api/saved-jobs/${jobId}`,{method:"DELETE"}); qc.invalidateQueries({queryKey:["saved"]});}
  return <DashboardShell title="Saved jobs"><section className="panel"><div className="panel-head"><h3>Saved opportunities</h3></div>{query.data?.items.length ? query.data.items.map((item)=><div className="table-row" key={item.id}><div><strong>{item.job.title}</strong><small>{item.job.location}</small></div><div className="row-actions"><Link className="button secondary" to={`/jobs/${item.jobId}`}>View</Link><button className="button ghost" onClick={()=>remove(item.jobId)}>Remove</button></div></div>) : <Empty text="You have no saved opportunities"/>}</section></DashboardShell>;
}

function ApplicationsPage() {
  const [status,setStatus]=useState(""); const [q,setQ]=useState("");
  const params=new URLSearchParams({... (status?{status}:{}),...(q?{q}:{})});
  const {data,refetch}=useQuery({queryKey:["applications",status,q],queryFn:()=>api<{items:any[];pagination:any}>(`/api/applications/me?${params}`)});
  async function withdraw(id:string){if(confirm("Withdraw this application?")){await api(`/api/applications/${id}/withdraw`,{method:"PATCH"});refetch();}}
  return <DashboardShell title="Applications"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search applications"/></label><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">All statuses</option>{["APPLIED","UNDER_REVIEW","SHORTLISTED","INTERVIEW","OFFERED","REJECTED","WITHDRAWN"].map(v=><option key={v}>{v}</option>)}</select></div><div className="applications-table"><div className="table-header"><span>Opportunity</span><span>Organisation</span><span>Applied</span><span>Status</span><span/></div>{data?.items.length ? data.items.map((item)=><div className="table-row" key={item.id}><div><strong>{item.job.title}</strong><small>{item.job.location}</small></div><span>{item.job.recruiter?.recruiterProfile?.organisation ?? "Organisation"}</span><span>{new Date(item.appliedAt).toLocaleDateString()}</span><Status status={item.status}/><button className="button ghost" disabled={["WITHDRAWN","REJECTED","OFFERED"].includes(item.status)} onClick={()=>withdraw(item.id)}>Withdraw</button></div>) : <Empty text="No applications match these filters"/>}</div></section></DashboardShell>;
}

function RecruiterDashboard() {
  const {data,isLoading}=useQuery({queryKey:["recruiterDashboard"],queryFn:()=>api<any>("/api/recruiter/dashboard")});
  if(isLoading)return <DashboardShell title="Dashboard"><div className="loading-card">Loading dashboard…</div></DashboardShell>;
  return <DashboardShell title="Dashboard"><section className="welcome recruiter-welcome"><div><span>Recruiter workspace</span><h2>Your hiring overview</h2><p>Track listings and candidate movement.</p></div><Link className="button primary" to="/recruiter/jobs">Manage listings</Link></section><div className="metric-grid"><Metric label="Active listings" value={data.activeListings} icon={BriefcaseBusiness}/><Metric label="Applications" value={data.totalApplications} icon={Users}/><Metric label="Under review" value={data.underReview} icon={Settings}/><Metric label="Shortlisted" value={data.shortlisted} icon={GraduationCap}/></div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><h3>Recent applicants</h3><Link to="/recruiter/applicants">View all</Link></div>{data.recentApplications.length?data.recentApplications.map((item:any)=><div className="activity-row" key={item.id}><span className="activity-icon"><UserRound size={17}/></span><div><strong>{item.student.name}</strong><small>{item.job.title}</small></div><Status status={item.status}/></div>):<Empty text="No recent applications"/>}</section><section className="panel"><div className="panel-head"><h3>Listing performance</h3></div>{data.listingPerformance.map((item:any)=><div className="recommend-row" key={item.id}><div><strong>{item.title}</strong><small>{item.applications} applications</small></div><Status status={item.status}/></div>)}</section></div></DashboardShell>;
}

function RecruiterJobs() {
  const [show,setShow]=useState(false); const [message,setMessage]=useState("");
  const {data,refetch}=useQuery({queryKey:["recruiterJobs"],queryFn:()=>api<{items:any[]}>("/api/recruiter/jobs")});
  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const payload:any={title:form.get("title"),description:form.get("description"),responsibilities:[String(form.get("responsibilities"))].filter(Boolean),requirements:[String(form.get("requirements"))].filter(Boolean),skills:String(form.get("skills")).split(",").map(v=>v.trim()).filter(Boolean),jobType:form.get("jobType"),workArrangement:form.get("workArrangement"),location:form.get("location"),experienceLevel:form.get("experienceLevel"),deadline:String(form.get("deadline")),status:form.get("status")};
    await api("/api/jobs",{method:"POST",body:JSON.stringify(payload)}); setShow(false); setMessage("Listing saved"); refetch();
  }
  async function close(job:any){await api(`/api/jobs/${job.id}`,{method:"PATCH",body:JSON.stringify({...job,status:"CLOSED",deadline:new Date(job.deadline).toISOString()})});refetch();}
  return <DashboardShell title="Job listings"><section className="panel"><div className="panel-head"><h3>Manage listings</h3><button className="button primary" onClick={()=>setShow(true)}>Create listing</button></div>{message&&<div className="alert success">{message}</div>}{show&&<form className="form-grid listing-form" onSubmit={create}><label>Job title<input name="title" required/></label><label>Location<input name="location" required/></label><label>Job type<select name="jobType"><option value="FULL_TIME">Full time</option><option value="INTERNSHIP">Internship</option><option value="PART_TIME">Part time</option><option value="CONTRACT">Contract</option></select></label><label>Work arrangement<select name="workArrangement"><option value="ON_SITE">On-site</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option></select></label><label>Experience<select name="experienceLevel"><option value="ENTRY">Entry</option><option value="MID">Mid</option><option value="SENIOR">Senior</option></select></label><label>Status<select name="status"><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option></select></label><label>Deadline<input name="deadline" type="date" required/></label><label>Required skills<input name="skills" placeholder="React, TypeScript"/></label><label className="span-two">Description<textarea name="description" required/></label><label>Responsibilities<textarea name="responsibilities"/></label><label>Requirements<textarea name="requirements"/></label><div className="span-two row-actions"><button className="button primary">Save listing</button><button type="button" className="button secondary" onClick={()=>setShow(false)}>Cancel</button></div></form>}<div className="listings-table">{data?.items.map((job)=><div className="table-row" key={job.id}><div><strong>{job.title}</strong><small>{job.location}</small></div><Status status={job.status}/><span>{job._count.applications} applicants</span><button className="button ghost" disabled={job.status==="CLOSED"} onClick={()=>close(job)}>{job.status==="CLOSED"?"Closed":"Close"}</button></div>)}</div></section></DashboardShell>;
}

function RecruiterApplicants() {
  const [q,setQ]=useState(""); const params=new URLSearchParams(q?{q}:{});
  const {data,refetch}=useQuery({queryKey:["applicants",q],queryFn:()=>api<{items:any[]}>(`/api/recruiter/applicants?${params}`)});
  async function update(id:string,status:string){await api(`/api/applications/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});refetch();}
  return <DashboardShell title="Applicants"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search candidates or roles"/></label></div>{data?.items.length?data.items.map((item)=><div className="table-row applicant-row" key={item.id}><div><strong>{item.student.name}</strong><small>{item.student.email} · {item.job.title}</small></div><Status status={item.status}/><select defaultValue={item.status} onChange={(e)=>update(item.id,e.target.value)}>{["APPLIED","UNDER_REVIEW","SHORTLISTED","INTERVIEW","OFFERED","REJECTED","WITHDRAWN"].map(v=><option key={v}>{v}</option>)}</select></div>):<Empty text="No applicants yet"/>}</section></DashboardShell>;
}

function RecruiterProfilePage() {
  const {data,refetch}=useQuery({queryKey:["recruiterProfile"],queryFn:()=>api<any>("/api/users/me/profile")});
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault(); const form=new FormData(event.currentTarget); await api("/api/users/me/recruiter-profile",{method:"PATCH",body:JSON.stringify(Object.fromEntries(form.entries()))});refetch();}
  const profile=data?.recruiterProfile ?? {};
  return <DashboardShell title="Organisation"><section className="panel profile-panel"><form className="form-grid" onSubmit={submit}><label>Organisation name<input name="organisation" defaultValue={profile.organisation}/></label><label>Designation<input name="designation" defaultValue={profile.designation}/></label><label>Website<input name="website" type="url" defaultValue={profile.website}/></label><label>Industry<input name="industry" defaultValue={profile.industry}/></label><label>Location<input name="location" defaultValue={profile.location}/></label><label>Organisation logo URL<input name="organisationLogo" defaultValue={profile.organisationLogo}/></label><label className="span-two">Organisation description<textarea name="description" defaultValue={profile.description}/></label><div className="span-two"><button className="button primary">Save organisation</button></div></form></section></DashboardShell>;
}

function AdminDashboard() {
  const {data,isLoading}=useQuery({queryKey:["adminDashboard"],queryFn:()=>api<any>("/api/admin/dashboard")});
  if(isLoading)return <DashboardShell title="Dashboard"><div className="loading-card">Loading dashboard…</div></DashboardShell>;
  return <DashboardShell title="Dashboard"><section className="welcome admin-welcome"><div><span>Administration</span><h2>Platform overview</h2><p>Monitor users, listings and application activity.</p></div></section><div className="metric-grid"><Metric label="Total users" value={data.totalUsers} icon={Users}/><Metric label="Students" value={data.totalStudents} icon={GraduationCap}/><Metric label="Recruiters" value={data.totalRecruiters} icon={Building2}/><Metric label="Listings" value={data.totalListings} icon={BriefcaseBusiness}/><Metric label="Published" value={data.publishedListings} icon={Search}/><Metric label="Applications" value={data.totalApplications} icon={FileText}/></div></DashboardShell>;
}

function AdminUsers() {
  const [q,setQ]=useState(""); const params=new URLSearchParams(q?{q}:{});
  const {data,refetch}=useQuery({queryKey:["adminUsers",q],queryFn:()=>api<{items:any[]}>(`/api/admin/users?${params}`)});
  async function status(user:any){await api(`/api/admin/users/${user.id}/status`,{method:"PATCH",body:JSON.stringify({accountStatus:user.accountStatus==="ACTIVE"?"SUSPENDED":"ACTIVE"})});refetch();}
  return <DashboardShell title="Users"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search users"/></label></div>{data?.items.map((user)=><div className="table-row" key={user.id}><div><strong>{user.name}</strong><small>{user.email}</small></div><span>{user.role}</span><Status status={user.accountStatus}/><button className="button ghost" onClick={()=>status(user)}>{user.accountStatus==="ACTIVE"?"Suspend":"Reactivate"}</button></div>)}</section></DashboardShell>;
}

function AdminJobs() {
  const [q,setQ]=useState(""); const params=new URLSearchParams(q?{q}:{});
  const {data,refetch}=useQuery({queryKey:["adminJobs",q],queryFn:()=>api<{items:any[]}>(`/api/admin/jobs?${params}`)});
  async function moderate(job:any,status:"PUBLISHED"|"CLOSED"){await api(`/api/admin/jobs/${job.id}/moderation`,{method:"PATCH",body:JSON.stringify({status,reason:"Moderation action from admin dashboard"})});refetch();}
  return <DashboardShell title="Listings"><section className="panel"><div className="application-toolbar"><label className="search-inline"><Search size={16}/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search listings"/></label></div>{data?.items.map((job)=><div className="table-row" key={job.id}><div><strong>{job.title}</strong><small>{job.recruiter?.recruiterProfile?.organisation??"Organisation"} · {job.location}</small></div><Status status={job.status}/><div className="row-actions">{job.status==="CLOSED"?<button className="button secondary" onClick={()=>moderate(job,"PUBLISHED")}>Publish</button>:<button className="button danger" onClick={()=>moderate(job,"CLOSED")}>Close</button>}</div></div>)}</section></DashboardShell>;
}

export default function App() {
  return <AuthProvider><Routes>
    <Route path="/" element={<Landing/>}/>
    <Route path="/jobs" element={<JobsPage/>}/>
    <Route path="/jobs/:id" element={<JobDetail/>}/>
    <Route path="/login" element={<AuthPage mode="login"/>}/>
    <Route path="/register" element={<AuthPage mode="register"/>}/>
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
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></AuthProvider>;
}
