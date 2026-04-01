/** GET /player/feedback-form */
export interface FeedbackChips {
  key: string;
  name: Record<string, string>;
}

export interface FeedbackSection {
  key: string;
  /** Locale code → label (same shape as {@link FeedbackChips.name}). */
  title: Record<string, string>;
  chips: FeedbackChips[];
}

export interface FeedbackScreen {
  sections: FeedbackSection[];
}

/** Stored JSON in `player_app_feedback.payload` */
export interface PlayerAppFeedbackPayload {
  rating: number;
  /** sectionKey → selected chip keys */
  selections: Record<string, string[]>;
  comment?: string;
  locale?: string;
}

/** POST /player/feedback — wire body (`gameId` / `participantId` omitted for home-screen feedback). */
export interface SubmitPlayerFeedbackDto {
  gameId?: number;
  participantId?: number;
  payload: PlayerAppFeedbackPayload;
}

export type ParsedSubmitPlayerFeedback =
  | { linkedToGame: true; gameId: number; participantId: number; payload: PlayerAppFeedbackPayload }
  | { linkedToGame: false; payload: PlayerAppFeedbackPayload };
