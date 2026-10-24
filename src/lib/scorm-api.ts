import { formatScormClock, formatScormDuration, fromLessonStatus, parseScormTime, type Commit } from "./scorm-runtime";

/**
 * The LMS side of the SCORM conversation, in the browser.
 *
 * A SCORM package finds an object called API (SCORM 1.2) or API_1484_11
 * (SCORM 2004) by searching up through its parent windows, then calls it:
 * start, read a value, write a value, save, finish. This is that object. It
 * keeps the data model in memory and hands every save to `onCommit` (which sends
 * it to the server), so what the package reports is what gets recorded.
 *
 * No React and no network in here, so it can be tested with the same call
 * sequences a real package makes.
 */
export type ScormInit = {
  version: "1.2" | "2004";
  learnerId: string;
  learnerName: string;
  location: string;
  suspendData: string;
  completionStatus: string;
  successStatus: string;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  totalSeconds: number;
  entry: "ab-initio" | "resume";
  masteryScore: number | null;
  /** Review of a finished course: the package runs, but nothing is recorded. */
  browse: boolean;
};

type Errors = Record<string, string>;
const ERRORS_12: Errors = {
  "0": "No error", "101": "General exception", "201": "Invalid argument error", "202": "Element cannot have children",
  "203": "Element not an array", "301": "Not initialized", "401": "Not implemented error", "402": "Invalid set value, element is a keyword",
  "403": "Element is read only", "404": "Element is write only", "405": "Incorrect data type",
};
const ERRORS_2004: Errors = {
  "0": "No error", "101": "General exception", "103": "Already initialized", "104": "Content instance terminated",
  "112": "Termination before initialization", "113": "Termination after termination", "122": "Retrieve data before initialization",
  "123": "Retrieve data after termination", "132": "Store data before initialization", "133": "Store data after termination",
  "142": "Commit before initialization", "143": "Commit after termination", "201": "General argument error",
  "301": "General get failure", "351": "General set failure", "391": "General commit failure",
  "401": "Undefined data model element", "402": "Unimplemented data model element", "403": "Data model element value not initialized",
  "404": "Data model element is read only", "405": "Data model element is write only", "406": "Data model element type mismatch",
  "407": "Data model element value out of range",
};

const STATUS_12 = new Set(["passed", "completed", "failed", "incomplete", "browsed", "not attempted"]);
const COMPLETION_2004 = new Set(["completed", "incomplete", "not attempted", "unknown"]);
const SUCCESS_2004 = new Set(["passed", "failed", "unknown"]);

const num = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** What a SCORM 1.2 package calls. The argument (always "") is part of the standard and is ignored. */
export type Api12 = {
  LMSInitialize(arg: string): string; LMSFinish(arg: string): string; LMSGetValue(key: string): string;
  LMSSetValue(key: string, value: string): string; LMSCommit(arg: string): string;
  LMSGetLastError(): string; LMSGetErrorString(code: string): string; LMSGetDiagnostic(code: string): string;
};
/** What a SCORM 2004 package calls. */
export type Api2004 = {
  Initialize(arg: string): string; Terminate(arg: string): string; GetValue(key: string): string;
  SetValue(key: string, value: string): string; Commit(arg: string): string;
  GetLastError(): string; GetErrorString(code: string): string; GetDiagnostic(code: string): string;
};

export class ScormApi {
  private data = new Map<string, string>();
  private state: "not initialized" | "running" | "terminated" = "not initialized";
  private errorCode = "0";
  private exitValue = "";
  private sessionSeconds = 0;
  /** Changed since the last save. */
  dirty = false;
  private readonly twoThousandFour: boolean;

  constructor(private readonly init: ScormInit, private readonly onCommit: (commit: Commit) => void) {
    this.twoThousandFour = init.version === "2004";
    const d = this.data;
    const score = (key: string, value: number | null) => d.set(key, value === null ? "" : String(value));
    if (this.twoThousandFour) {
      d.set("cmi._version", "1.0");
      d.set("cmi.learner_id", init.learnerId);
      d.set("cmi.learner_name", init.learnerName);
      d.set("cmi.location", init.location);
      d.set("cmi.suspend_data", init.suspendData);
      // A first launch reads "unknown", as 2004 content expects; "not attempted" is only our own word for it.
      d.set("cmi.completion_status", init.completionStatus !== "not attempted" && COMPLETION_2004.has(init.completionStatus) ? init.completionStatus : "unknown");
      d.set("cmi.success_status", SUCCESS_2004.has(init.successStatus) ? init.successStatus : "unknown");
      score("cmi.score.raw", init.scoreRaw);
      score("cmi.score.min", init.scoreMin);
      score("cmi.score.max", init.scoreMax);
      d.set("cmi.score.scaled", init.scoreRaw !== null && init.scoreMax ? String(Math.round((init.scoreRaw / init.scoreMax) * 10000) / 10000) : "");
      d.set("cmi.entry", init.entry);
      d.set("cmi.mode", init.browse ? "browse" : "normal");
      d.set("cmi.credit", init.browse ? "no-credit" : "credit");
      d.set("cmi.total_time", formatScormDuration(init.totalSeconds));
      d.set("cmi.scaled_passing_score", init.masteryScore === null ? "" : String(init.masteryScore / 100));
      d.set("cmi.learner_preference.audio_level", "1");
      d.set("cmi.learner_preference.language", "");
      d.set("cmi.learner_preference.delivery_speed", "1");
      d.set("cmi.learner_preference.audio_captioning", "0");
      d.set("cmi.interactions._count", "0");
      d.set("cmi.objectives._count", "0");
      d.set("cmi.comments_from_learner._count", "0");
      d.set("cmi.comments_from_lms._count", "0");
      d.set("adl.nav.request", "_none_");
    } else {
      d.set("cmi.core._children", "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time");
      d.set("cmi.core.score._children", "raw,min,max");
      d.set("cmi.core.student_id", init.learnerId);
      d.set("cmi.core.student_name", init.learnerName);
      d.set("cmi.core.lesson_location", init.location);
      d.set("cmi.suspend_data", init.suspendData);
      d.set("cmi.core.lesson_status", init.completionStatus === "not attempted" && init.successStatus === "unknown" ? "not attempted" : this.statusFor12(init));
      score("cmi.core.score.raw", init.scoreRaw);
      score("cmi.core.score.min", init.scoreMin);
      score("cmi.core.score.max", init.scoreMax);
      d.set("cmi.core.entry", init.entry === "resume" ? "resume" : "ab-initio");
      d.set("cmi.core.lesson_mode", init.browse ? "browse" : "normal");
      d.set("cmi.core.credit", init.browse ? "no-credit" : "credit");
      d.set("cmi.core.total_time", formatScormClock(init.totalSeconds));
      d.set("cmi.student_data.mastery_score", init.masteryScore === null ? "" : String(init.masteryScore));
      d.set("cmi.launch_data", "");
      d.set("cmi.comments", "");
      d.set("cmi.comments_from_lms", "");
    }
  }

  private statusFor12(init: Pick<ScormInit, "completionStatus" | "successStatus">): string {
    if (init.successStatus === "passed") return "passed";
    if (init.successStatus === "failed") return "failed";
    if (init.completionStatus === "completed") return "completed";
    return init.completionStatus === "incomplete" ? "incomplete" : "not attempted";
  }

  private readOnly(key: string): boolean {
    if (this.twoThousandFour) {
      return /^cmi\.(_version|learner_id|learner_name|entry|mode|credit|total_time|launch_data|scaled_passing_score|completion_threshold|max_time_allowed|time_limit_action|comments_from_lms\..*)$/.test(key) || /\._count$/.test(key);
    }
    return /^cmi\.(core\.(student_id|student_name|credit|entry|total_time|lesson_mode|_children|score\._children)|launch_data|student_data\..*|comments_from_lms)$/.test(key);
  }

  private writeOnly(key: string): boolean {
    return this.twoThousandFour ? /^cmi\.(exit|session_time)$/.test(key) : /^cmi\.core\.(exit|session_time)$/.test(key);
  }

  private fail(code: string): string {
    this.errorCode = code;
    return "false";
  }

  // ---- shared operations; the two public APIs below are thin names over them ----

  private doInitialize(): string {
    if (this.state === "running") return this.fail(this.twoThousandFour ? "103" : "101");
    if (this.state === "terminated") return this.fail(this.twoThousandFour ? "104" : "101");
    this.state = "running";
    this.errorCode = "0";
    return "true";
  }

  private doGet(key: string): string {
    if (this.state !== "running") { this.errorCode = this.twoThousandFour ? (this.state === "terminated" ? "123" : "122") : "301"; return ""; }
    if (this.writeOnly(key)) { this.errorCode = this.twoThousandFour ? "405" : "404"; return ""; }
    const value = this.data.get(key);
    if (value === undefined) {
      this.errorCode = this.twoThousandFour ? (/^cmi\.(interactions|objectives|comments_from_learner)\.\d+/.test(key) ? "403" : "401") : "401";
      return "";
    }
    this.errorCode = "0";
    return value;
  }

  private doSet(key: string, value: string): string {
    if (this.state !== "running") return this.fail(this.twoThousandFour ? (this.state === "terminated" ? "133" : "132") : "301");
    if (this.init.browse) { this.errorCode = "0"; return "true"; }
    if (this.readOnly(key)) return this.fail(this.twoThousandFour ? "404" : "403");
    value = String(value);

    if (this.twoThousandFour) {
      if (key === "cmi.completion_status" && !COMPLETION_2004.has(value)) return this.fail("406");
      if (key === "cmi.success_status" && !SUCCESS_2004.has(value)) return this.fail("406");
      if (key === "cmi.exit") { this.exitValue = value; }
      if (key === "cmi.session_time") { this.sessionSeconds = parseScormTime(value) ?? this.sessionSeconds; }
      const indexed = key.match(/^cmi\.(interactions|objectives|comments_from_learner)\.(\d+)\./);
      if (indexed) {
        const count = Math.max(Number(this.data.get(`cmi.${indexed[1]}._count`) ?? 0), Number(indexed[2]) + 1);
        this.data.set(`cmi.${indexed[1]}._count`, String(count));
      }
    } else {
      if (key === "cmi.core.lesson_status" && !STATUS_12.has(value.toLowerCase())) return this.fail("405");
      if (key === "cmi.core.exit") { this.exitValue = value; }
      if (key === "cmi.core.session_time") { this.sessionSeconds = parseScormTime(value) ?? this.sessionSeconds; }
      if (key === "cmi.core.lesson_status") value = value.toLowerCase();
    }
    this.data.set(key, value);
    this.dirty = true;
    this.errorCode = "0";
    return "true";
  }

  private doCommit(finish: boolean): string {
    if (this.state !== "running") return this.fail(this.twoThousandFour ? (this.state === "terminated" ? "143" : "142") : "301");
    this.errorCode = "0";
    if (!this.init.browse) {
      this.onCommit(this.snapshot(finish));
      this.dirty = false;
    }
    return "true";
  }

  private doFinish(): string {
    if (this.state !== "running") return this.fail(this.twoThousandFour ? (this.state === "terminated" ? "113" : "112") : "301");
    const result = this.doCommit(true);
    this.state = "terminated";
    return result;
  }

  /** What to save for a learner who is leaving or has been quiet a while: the current state, with the changes marked as saved. */
  flush(): Commit {
    this.dirty = false;
    return this.snapshot(false);
  }

  /** Everything worth recording, as the server expects it. */
  snapshot(finish = false): Commit {
    const d = this.data;
    const commit: Commit = { totalSeconds: Math.floor(this.init.totalSeconds + this.sessionSeconds), finish, exit: this.exitValue };
    if (this.twoThousandFour) {
      commit.completionStatus = d.get("cmi.completion_status") as Commit["completionStatus"];
      commit.successStatus = d.get("cmi.success_status") as Commit["successStatus"];
      commit.location = d.get("cmi.location") ?? "";
      commit.scoreRaw = num(d.get("cmi.score.raw"));
      commit.scoreMin = num(d.get("cmi.score.min"));
      commit.scoreMax = num(d.get("cmi.score.max"));
    } else {
      const status = d.get("cmi.core.lesson_status") ?? "not attempted";
      commit.lessonStatus = status;
      Object.assign(commit, fromLessonStatus(status));
      commit.location = d.get("cmi.core.lesson_location") ?? "";
      commit.scoreRaw = num(d.get("cmi.core.score.raw"));
      commit.scoreMin = num(d.get("cmi.core.score.min"));
      commit.scoreMax = num(d.get("cmi.core.score.max"));
    }
    commit.suspendData = d.get("cmi.suspend_data") ?? "";
    return commit;
  }

  private message(code: string): string {
    return (this.twoThousandFour ? ERRORS_2004 : ERRORS_12)[code] ?? "Unknown error";
  }

  /** The object a SCORM 1.2 package looks for as `API`. */
  api12(): Api12 {
    return {
      LMSInitialize: () => this.doInitialize(),
      LMSFinish: () => this.doFinish(),
      LMSGetValue: (key: string) => this.doGet(key),
      LMSSetValue: (key: string, value: string) => this.doSet(key, value),
      LMSCommit: () => this.doCommit(false),
      LMSGetLastError: () => this.errorCode,
      LMSGetErrorString: (code: string) => this.message(String(code)),
      LMSGetDiagnostic: (code: string) => this.message(String(code || this.errorCode)),
    };
  }

  /** The object a SCORM 2004 package looks for as `API_1484_11`. */
  api2004(): Api2004 {
    return {
      Initialize: () => this.doInitialize(),
      Terminate: () => this.doFinish(),
      GetValue: (key: string) => this.doGet(key),
      SetValue: (key: string, value: string) => this.doSet(key, value),
      Commit: () => this.doCommit(false),
      GetLastError: () => this.errorCode,
      GetErrorString: (code: string) => this.message(String(code)),
      GetDiagnostic: (code: string) => this.message(String(code || this.errorCode)),
    };
  }
}
