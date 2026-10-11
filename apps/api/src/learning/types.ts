import type { DurationArtifact } from '@futureroi/prediction';
import type { LearningArtifactPurpose, LearningGate } from '../contracts/learning.ts';
import type { TodaySnapshot } from '../prediction/store.ts';
export interface StoredLearningArtifact { id: string; hash: string; modelVersion: string; createdAt: Date; expiresAt: Date;
  purpose?: LearningArtifactPurpose;
  trainingCutoff: string; goalSettingsRevision: number; answerRevision: number; inputHash: string;
  numeric: DurationArtifact | null; gate: LearningGate; comparison?: LearningFitPlan; evidenceHash?: string; }
export interface LearningReadState { snapshot: TodaySnapshot; participationId: string | null; participationExpiresAt: Date | null;
  participationJoinedAt: Date | null;
  holdoutThrough: string | null; fitGeneration: number; activeRevision: number; activeArtifactId: string | null; artifacts: StoredLearningArtifact[]; }
export interface LearningFitComputation { numeric: DurationArtifact | null; gate: LearningGate; trainingCutoff: string;
  purpose?: LearningArtifactPurpose;
  inputHash: string; modelVersion: string; comparison: LearningFitPlan; evidenceHash: string; }

export interface LearningFitPlan { protocolVersion: 'duration-chronological-v1' | 'duration-chronological-v2' | 'duration-experimental-v1'; horizonDays: number; trainingCutoff: string;
  validationAnchors: string[]; testAnchors: string[]; holdoutThrough: string | null; reason: string | null; }
