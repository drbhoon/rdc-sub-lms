import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cancelMeeting, createMeeting, meetConfig, signedAssertion, updateMeeting, type MeetConfig } from "./google-meet";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const config: MeetConfig = {
  clientEmail: "lms@project.iam.gserviceaccount.com", privateKey, organizer: "learning@rdcc.ai",
  calendarId: "primary", tokenUrl: "https://token.test/token", apiBase: "https://calendar.test/v3",
};

type Call = { method: string; url: string; body: unknown };

/** A stand-in for Google that answers by what is asked and remembers every call. */
function fakeGoogle(answers: Record<string, () => { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const raw = init?.body;
    calls.push({ method, url, body: raw instanceof URLSearchParams ? Object.fromEntries(raw) : raw ? JSON.parse(String(raw)) : null });
    const key = Object.keys(answers).find((pattern) => `${method} ${url}`.includes(pattern));
    const answer = key ? answers[key]() : { status: 500, body: { error: { message: "unexpected call" } } };
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const token = { "token.test": () => ({ body: { access_token: "tok-1" } }) };
const details = { title: "Induction day 1", startsAt: new Date("2026-12-01T04:30:00Z"), durationMinutes: 90, description: "Induction" };

describe("meetConfig", () => {
  it("is off until the three account settings are given, and blanks do not count", () => {
    expect(meetConfig({})).toBeNull();
    expect(meetConfig({ GOOGLE_MEET_CLIENT_EMAIL: "a@b", GOOGLE_MEET_PRIVATE_KEY: "k", GOOGLE_MEET_ORGANIZER: "  " })).toBeNull();
  });

  it("reads the key with its line breaks restored, and defaults the calendar", () => {
    const found = meetConfig({ GOOGLE_MEET_CLIENT_EMAIL: "a@b", GOOGLE_MEET_PRIVATE_KEY: "-----BEGIN-----\\nabc\\n-----END-----", GOOGLE_MEET_ORGANIZER: "x@rdcc.ai" });
    expect(found?.privateKey).toBe("-----BEGIN-----\nabc\n-----END-----");
    expect(found?.calendarId).toBe("primary");
    expect(found?.apiBase).toBe("https://www.googleapis.com/calendar/v3");
  });
});

describe("signedAssertion", () => {
  it("is signed with the service account key, acts as the organiser, and asks only for calendar events", () => {
    const [header, claims, signature] = signedAssertion(config, 1_800_000_000).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: config.clientEmail, sub: "learning@rdcc.ai", scope: "https://www.googleapis.com/auth/calendar.events", aud: config.tokenUrl, iat: 1_800_000_000,
    });
    const verifier = createVerify("RSA-SHA256").update(`${header}.${claims}`);
    expect(verifier.verify(createPublicKey(publicKey), Buffer.from(signature, "base64url"))).toBe(true);
  });
});

describe("createMeeting", () => {
  it("makes an event with a Meet room, tells nobody, and returns the room's link", async () => {
    const google = fakeGoogle({ ...token, "POST https://calendar.test": () => ({ body: { id: "evt1", hangoutLink: "https://meet.google.com/abc-defg-hij" } }) });
    const meeting = await createMeeting(config, details, google.fetchImpl);
    expect(meeting).toEqual({ eventId: "evt1", meetUrl: "https://meet.google.com/abc-defg-hij" });
    const create = google.calls.find((call) => call.url.includes("calendar.test"))!;
    expect(create.url).toContain("/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none");
    expect(create.body).toMatchObject({
      summary: "Induction day 1",
      start: { dateTime: "2026-12-01T04:30:00.000Z", timeZone: "Asia/Kolkata" },
      end: { dateTime: "2026-12-01T06:00:00.000Z" },
      conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
    expect((create.body as { attendees?: unknown }).attendees).toBeUndefined();
  });

  it("falls back to the entry point when there is no hangoutLink", async () => {
    const google = fakeGoogle({ ...token, "POST https://calendar.test": () => ({ body: { id: "evt2", conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://meet.google.com/xyz-abcd-efg" }] } } }) });
    expect((await createMeeting(config, details, google.fetchImpl)).meetUrl).toBe("https://meet.google.com/xyz-abcd-efg");
  });

  it("asks again when the room is still being made", async () => {
    let asked = 0;
    const google = fakeGoogle({
      ...token,
      "POST https://calendar.test": () => ({ body: { id: "evt3" } }),
      "GET https://calendar.test": () => ({ body: ++asked < 2 ? { id: "evt3" } : { id: "evt3", hangoutLink: "https://meet.google.com/aaa-bbbb-ccc" } }),
    });
    expect((await createMeeting(config, details, google.fetchImpl)).meetUrl).toBe("https://meet.google.com/aaa-bbbb-ccc");
    expect(asked).toBe(2);
  });

  it("says what is wrong when Google refuses the sign-in", async () => {
    const google = fakeGoogle({ "token.test": () => ({ status: 401, body: { error: "unauthorized_client", error_description: "Client is unauthorized to retrieve access tokens using this method" } }) });
    await expect(createMeeting(config, details, google.fetchImpl)).rejects.toThrow(/refused the sign-in.*unauthorized to retrieve access tokens.*learning@rdcc\.ai/s);
  });

  it("says what is wrong when the calendar refuses", async () => {
    const google = fakeGoogle({ ...token, "POST https://calendar.test": () => ({ status: 403, body: { error: { message: "Insufficient Permission" } } }) });
    await expect(createMeeting(config, details, google.fetchImpl)).rejects.toThrow(/Insufficient Permission/);
  });
});

describe("updateMeeting and cancelMeeting", () => {
  it("changes the time of the same event, leaving the room alone", async () => {
    const google = fakeGoogle({ ...token, "PATCH https://calendar.test": () => ({ body: { id: "evt1" } }) });
    await updateMeeting(config, "evt1", { ...details, durationMinutes: 30 }, google.fetchImpl);
    const patch = google.calls.find((call) => call.method === "PATCH")!;
    expect(patch.url).toContain("/events/evt1?sendUpdates=none");
    expect(patch.body).toMatchObject({ end: { dateTime: "2026-12-01T05:00:00.000Z" } });
    expect((patch.body as { conferenceData?: unknown }).conferenceData).toBeUndefined();
  });

  it("removes the event, and an event already gone is fine", async () => {
    await cancelMeeting(config, "evt1", fakeGoogle({ ...token, "DELETE https://calendar.test": () => ({ status: 204 }) }).fetchImpl);
    await cancelMeeting(config, "evt1", fakeGoogle({ ...token, "DELETE https://calendar.test": () => ({ status: 410, body: {} }) }).fetchImpl);
  });
});
