import { assert } from "@effect/vitest";
import type { ProviderReplayTranscript } from "@t3tools/contracts";

import type { OrchestratorV2ScenarioResult } from "../../OrchestratorScenario.ts";
import {
  assertBaseProjection,
  assertSemanticProjectionIntegrity,
  projectionFor,
  type OrchestratorFixtureInput,
} from "../shared.ts";

export function grokMonitorEarlyExitInput(): OrchestratorFixtureInput {
  return {
    steps: [
      { type: "message", text: "Review the changes and report back." },
      { type: "finish_held_run", targetRunIndex: 1, status: "completed" },
      { type: "release_replay_gate", label: "wake-report" },
      { type: "finish_held_run", targetRunIndex: 2, status: "completed" },
    ],
  };
}

export function assertGrokMonitorEarlyExitOutput(
  result: OrchestratorV2ScenarioResult,
  transcript: ProviderReplayTranscript,
) {
  assertBaseProjection({
    result,
    transcript,
    runCount: 2,
    runStatuses: ["completed", "completed"],
  });
  const projection = projectionFor(result, transcript.scenario);
  assertSemanticProjectionIntegrity(projection);

  const [rootRun, wakeRun] = projection.runs;
  const monitors = projection.turnItems.filter((item) => item.type === "command_execution");
  assert.lengthOf(monitors, 1);
  const monitor = monitors[0];
  assert.equal(monitor?.runId, rootRun?.id);
  assert.equal(monitor?.status, "failed");
  assert.equal(monitor?.output, "Command unavailable.\n");

  const monitorCompletedAt = result.domainEvents.findIndex(
    (event) =>
      event.type === "turn-item.updated" &&
      event.payload.id === monitor?.id &&
      event.payload.status === "failed",
  );
  // A run can report `completed` again after its turn-end checkpoint; order by the first report.
  const terminalRuns = result.domainEvents.flatMap((event, index, events) =>
    event.type === "run.updated" &&
    event.payload.status === "completed" &&
    events.findIndex(
      (earlier) =>
        earlier.type === "run.updated" &&
        earlier.payload.id === event.payload.id &&
        earlier.payload.status === "completed",
    ) === index
      ? [{ id: event.payload.id, index }]
      : [],
  );
  assert.deepEqual(
    terminalRuns.map((run) => run.id),
    [rootRun?.id, wakeRun?.id],
  );
  assert.isAtLeast(monitorCompletedAt, 0);
  assert.isAbove(terminalRuns[0]!.index, monitorCompletedAt);
  assert.isTrue(
    projection.turnItems.some(
      (item) =>
        item.runId === wakeRun?.id &&
        item.type === "assistant_message" &&
        item.text === "The monitor exited with code 127." &&
        item.status === "completed",
    ),
  );
}
