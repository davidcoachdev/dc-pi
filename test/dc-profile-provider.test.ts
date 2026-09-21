import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveProfilesFilePath,
  readProfilesInfo,
  switchActiveProfile,
} from "../src/features/dc-sidebar/providers/dc-profile-provider.ts";

test("resolveProfilesFilePath resolves existing or default profiles.json", () => {
  const p = resolveProfilesFilePath();
  assert.ok(typeof p === "string");
  assert.ok(p.endsWith("profiles.json"));
});

test("readProfilesInfo reads valid profiles file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-profiles-test-"));
  const tmpProfiles = path.join(tmpDir, "profiles.json");

  fs.writeFileSync(
    tmpProfiles,
    JSON.stringify({
      kind: "gentle-pi.agent_model_profiles",
      version: 1,
      active: "AC-06-Gemini",
      profiles: {
        current: {
          orchestrator: { model: "cpam/ac06/gemini-3.8-flash-high" },
        },
        "AC-06-Gemini": {},
        "AC-05-Flash": {},
      },
    }),
    "utf8"
  );

  const info = readProfilesInfo(tmpProfiles);
  assert.equal(info.activeProfile, "AC-06-Gemini");
  assert.equal(info.profiles.length, 3);

  const current = info.profiles.find((p) => p.name === "current");
  assert.ok(current);
  assert.equal(current.isActive, false);
  assert.equal(current.model, "cpam/ac06/gemini-3.8-flash-high");

  const gemini = info.profiles.find((p) => p.name === "AC-06-Gemini");
  assert.ok(gemini);
  assert.equal(gemini.isActive, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("switchActiveProfile switches active profile and updates settings.json", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-profiles-switch-"));
  const tmpProfiles = path.join(tmpDir, "profiles.json");
  const tmpSettings = path.join(tmpDir, "settings.json");

  fs.writeFileSync(
    tmpProfiles,
    JSON.stringify({
      kind: "gentle-pi.agent_model_profiles",
      version: 1,
      active: "AC-06-Gemini",
      profiles: {
        current: {
          orchestrator: { model: "cpam/ac06/gemini-3.8-flash-high" },
        },
        "AC-06-Gemini": {},
      },
    }),
    "utf8"
  );

  fs.writeFileSync(
    tmpSettings,
    JSON.stringify({
      defaultProvider: "cpam",
      defaultModel: "ac06/gemini-3.8-flash-high",
    }),
    "utf8"
  );

  const switched = switchActiveProfile("current", tmpProfiles, tmpSettings);
  assert.equal(switched, true);

  const updatedProfiles = JSON.parse(fs.readFileSync(tmpProfiles, "utf8"));
  assert.equal(updatedProfiles.active, "current");

  const updatedSettings = JSON.parse(fs.readFileSync(tmpSettings, "utf8"));
  assert.equal(updatedSettings.defaultProvider, "cpam");
  assert.equal(updatedSettings.defaultModel, "ac06/gemini-3.8-flash-high");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
