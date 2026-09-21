import { PRESET_IDS, describePreset, presetLabel, runPreset, type PresetId } from "./effectGen";
import {
  ERROR_PRESET_IDS,
  describeErrorPreset,
  errorPresetLabel,
  runErrorPreset,
  type ErrorPresetId,
} from "./errorChannel";
import {
  LAYER_PRESET_IDS,
  describeLayerPreset,
  layerPresetLabel,
  runLayerPreset,
  type LayerPresetId,
} from "./layerProvide";
import {
  FIBER_PRESET_IDS,
  describeFiberPreset,
  fiberPresetLabel,
  runFiberPreset,
  type FiberPresetId,
} from "./fiberRaceAll";
import {
  SCHEDULE_PRESET_IDS,
  describeSchedulePreset,
  runSchedulePreset,
  schedulePresetLabel,
  type SchedulePresetId,
} from "./scheduleLab";
import {
  SCHEMA_PRESET_IDS,
  describeSchemaPreset,
  runSchemaPreset,
  schemaPresetLabel,
  type SchemaPresetId,
} from "./schemaDecode";
import {
  SCOPE_PRESET_IDS,
  describeScopePreset,
  runScopePreset,
  scopePresetLabel,
  type ScopePresetId,
} from "./scopeFinalizers";

export type LabDescribeResult = {
  mode: "describe";
  executed: false;
  presetId: string;
  steps: readonly { id: string; label: string }[];
};

export type LabEngine = {
  presetIds: readonly string[];
  presetLabel: (id: string) => string;
  describe: (presetId: string) => LabDescribeResult;
  run: (presetId: string) => unknown | Promise<unknown>;
};

const ENGINES: Record<string, LabEngine> = {
  i01: {
    presetIds: PRESET_IDS,
    presetLabel: (id) => presetLabel(id as PresetId),
    describe: (id) => describePreset(id as PresetId),
    run: (id) => runPreset(id as PresetId),
  },
  i02: {
    presetIds: ERROR_PRESET_IDS,
    presetLabel: (id) => errorPresetLabel(id as ErrorPresetId),
    describe: (id) => describeErrorPreset(id as ErrorPresetId),
    run: (id) => runErrorPreset(id as ErrorPresetId),
  },
  i03: {
    presetIds: LAYER_PRESET_IDS,
    presetLabel: (id) => layerPresetLabel(id as LayerPresetId),
    describe: (id) => describeLayerPreset(id as LayerPresetId),
    run: (id) => runLayerPreset(id as LayerPresetId),
  },
  i04: {
    presetIds: FIBER_PRESET_IDS,
    presetLabel: (id) => fiberPresetLabel(id as FiberPresetId),
    describe: (id) => describeFiberPreset(id as FiberPresetId),
    run: (id) => runFiberPreset(id as FiberPresetId),
  },
  i05: {
    presetIds: SCHEDULE_PRESET_IDS,
    presetLabel: (id) => schedulePresetLabel(id as SchedulePresetId),
    describe: (id) => describeSchedulePreset(id as SchedulePresetId),
    run: (id) => runSchedulePreset(id as SchedulePresetId),
  },
  i06: {
    presetIds: SCHEMA_PRESET_IDS,
    presetLabel: (id) => schemaPresetLabel(id as SchemaPresetId),
    describe: (id) => describeSchemaPreset(id as SchemaPresetId),
    run: (id) => runSchemaPreset(id as SchemaPresetId),
  },
  i07: {
    presetIds: SCOPE_PRESET_IDS,
    presetLabel: (id) => scopePresetLabel(id as ScopePresetId),
    describe: (id) => describeScopePreset(id as ScopePresetId),
    run: (id) => runScopePreset(id as ScopePresetId),
  },
};

export function engineForLab(labId: string): LabEngine {
  const engine = ENGINES[labId];
  if (!engine) {
    throw new Error(`No Effect engine registered for lab ${labId}`);
  }
  return engine;
}
