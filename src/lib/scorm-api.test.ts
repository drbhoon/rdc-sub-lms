import { describe, expect, it } from "vitest";
import { ScormApi, type ScormInit } from "./scorm-api";
import type { Commit } from "./scorm-runtime";

const base = (extra: Partial<ScormInit> = {}): ScormInit => ({
  version: "1.2", learnerId: "E1", learnerName: "Kumar, Anil", location: "", suspendData: "", completionStatus: "not attempted",
  successStatus: "unknown", scoreRaw: null, scoreMin: null, scoreMax: null, totalSeconds: 0, entry: "ab-initio",
  masteryScore: 80, browse: false, ...extra,
});

function open12(extra: Partial<ScormInit> = {}) {
  const commits: Commit[] = [];
  const core = new ScormApi(base(extra), (commit) => commits.push(commit));
  return { core, api: core.api12(), commits };
}
function open2004(extra: Partial<ScormInit> = {}) {
  const commits: Commit[] = [];
  const core = new ScormApi(base({ version: "2004", ...extra }), (commit) => commits.push(commit));
  return { core, api: core.api2004(), commits };
}

describe("SCORM 1.2, the way Storyline calls it", () => {
  it("starts, reads the basics, records progress and a pass, and finishes", () => {
    const { api, commits } = open12();
    expect(api.LMSInitialize("")).toBe("true");
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("not attempted");
    expect(api.LMSGetValue("cmi.core.entry")).toBe("ab-initio");
    expect(api.LMSGetValue("cmi.core.student_name")).toBe("Kumar, Anil");
    expect(api.LMSGetValue("cmi.student_data.mastery_score")).toBe("80");
    expect(api.LMSSetValue("cmi.core.lesson_status", "incomplete")).toBe("true");
    expect(api.LMSSetValue("cmi.core.lesson_location", "slide-7")).toBe("true");
    expect(api.LMSSetValue("cmi.suspend_data", "abc=1")).toBe("true");
    expect(api.LMSCommit("")).toBe("true");
    expect(commits[0]).toMatchObject({ completionStatus: "incomplete", successStatus: "unknown", location: "slide-7", suspendData: "abc=1", finish: false });

    api.LMSSetValue("cmi.core.score.raw", "92");
    api.LMSSetValue("cmi.core.score.min", "0");
    api.LMSSetValue("cmi.core.score.max", "100");
    api.LMSSetValue("cmi.core.lesson_status", "passed");
    api.LMSSetValue("cmi.core.session_time", "0000:12:30.00");
    api.LMSSetValue("cmi.core.exit", "");
    expect(api.LMSFinish("")).toBe("true");
    expect(commits[1]).toMatchObject({ completionStatus: "completed", successStatus: "passed", scoreRaw: 92, scoreMax: 100, totalSeconds: 750, finish: true, exit: "" });
  });

  it("resumes where the learner left off", () => {
    const { api } = open12({ entry: "resume", location: "slide-7", suspendData: "abc=1", completionStatus: "incomplete", totalSeconds: 300 });
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core.entry")).toBe("resume");
    expect(api.LMSGetValue("cmi.core.lesson_location")).toBe("slide-7");
    expect(api.LMSGetValue("cmi.suspend_data")).toBe("abc=1");
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("incomplete");
    expect(api.LMSGetValue("cmi.core.total_time")).toBe("0000:05:00.00");
  });

  it("adds this session's time to what was spent before", () => {
    const { api, commits } = open12({ totalSeconds: 300 });
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.session_time", "0000:01:00.00");
    api.LMSCommit("");
    expect(commits[0].totalSeconds).toBe(360);
  });

  it("a suspended exit pauses rather than ends the attempt", () => {
    const { api, commits } = open12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.exit", "suspend");
    api.LMSFinish("");
    expect(commits[0]).toMatchObject({ finish: true, exit: "suspend" });
  });

  it("refuses to write read-only and read write-only values, and says why", () => {
    const { api } = open12();
    api.LMSInitialize("");
    expect(api.LMSSetValue("cmi.core.student_id", "X")).toBe("false");
    expect(api.LMSGetLastError()).toBe("403");
    expect(api.LMSGetValue("cmi.core.exit")).toBe("");
    expect(api.LMSGetLastError()).toBe("404");
    expect(api.LMSSetValue("cmi.core.lesson_status", "done")).toBe("false");
    expect(api.LMSGetLastError()).toBe("405");
    expect(api.LMSGetErrorString("405")).toBe("Incorrect data type");
  });

  it("answers an unknown element with 'not implemented' and carries on", () => {
    const { api } = open12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.something.odd")).toBe("");
    expect(api.LMSGetLastError()).toBe("401");
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("not attempted");
    expect(api.LMSGetLastError()).toBe("0");
  });

  it("refuses everything before it is started and after it has finished", () => {
    const { api } = open12();
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("");
    expect(api.LMSGetLastError()).toBe("301");
    expect(api.LMSSetValue("cmi.core.lesson_status", "passed")).toBe("false");
    api.LMSInitialize("");
    api.LMSFinish("");
    expect(api.LMSSetValue("cmi.core.lesson_status", "passed")).toBe("false");
  });
});

describe("SCORM 2004", () => {
  it("records completion, success and a scaled score", () => {
    const { api, commits } = open2004();
    expect(api.Initialize("")).toBe("true");
    expect(api.GetValue("cmi.completion_status")).toBe("unknown");
    expect(api.GetValue("cmi.mode")).toBe("normal");
    expect(api.SetValue("cmi.completion_status", "completed")).toBe("true");
    expect(api.SetValue("cmi.success_status", "failed")).toBe("true");
    expect(api.SetValue("cmi.score.raw", "55")).toBe("true");
    expect(api.SetValue("cmi.score.max", "100")).toBe("true");
    expect(api.SetValue("cmi.session_time", "PT5M30S")).toBe("true");
    expect(api.SetValue("cmi.exit", "normal")).toBe("true");
    expect(api.Terminate("")).toBe("true");
    expect(commits[0]).toMatchObject({ completionStatus: "completed", successStatus: "failed", scoreRaw: 55, scoreMax: 100, totalSeconds: 330, finish: true, exit: "normal" });
  });

  it("accepts interactions and objectives and counts them", () => {
    const { api } = open2004();
    api.Initialize("");
    expect(api.GetValue("cmi.interactions._count")).toBe("0");
    expect(api.SetValue("cmi.interactions.0.id", "q1")).toBe("true");
    expect(api.SetValue("cmi.interactions.1.id", "q2")).toBe("true");
    expect(api.SetValue("cmi.interactions.1.result", "correct")).toBe("true");
    expect(api.GetValue("cmi.interactions._count")).toBe("2");
    expect(api.SetValue("cmi.interactions._count", "9")).toBe("false");
    expect(api.GetLastError()).toBe("404");
  });

  it("rejects a made-up status", () => {
    const { api } = open2004();
    api.Initialize("");
    expect(api.SetValue("cmi.completion_status", "finished")).toBe("false");
    expect(api.GetLastError()).toBe("406");
  });

  it("will not start twice", () => {
    const { api } = open2004();
    expect(api.Initialize("")).toBe("true");
    expect(api.Initialize("")).toBe("false");
    expect(api.GetLastError()).toBe("103");
  });

  it("hands back the saved position and data on resume", () => {
    const { api } = open2004({ entry: "resume", location: "3", suspendData: "xyz", completionStatus: "incomplete", successStatus: "unknown" });
    api.Initialize("");
    expect(api.GetValue("cmi.entry")).toBe("resume");
    expect(api.GetValue("cmi.location")).toBe("3");
    expect(api.GetValue("cmi.suspend_data")).toBe("xyz");
    expect(api.GetValue("cmi.completion_status")).toBe("incomplete");
  });
});

describe("reviewing a finished course", () => {
  it("lets the package run and records nothing", () => {
    const { api, commits } = open12({ browse: true, completionStatus: "completed", successStatus: "passed", scoreRaw: 90 });
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core.lesson_mode")).toBe("browse");
    expect(api.LMSGetValue("cmi.core.credit")).toBe("no-credit");
    expect(api.LMSSetValue("cmi.core.lesson_status", "failed")).toBe("true");
    api.LMSCommit("");
    api.LMSFinish("");
    expect(commits).toEqual([]);
  });
});
