/** GET /player/feedback-form */
export interface FeedbackChips {
  key: string;
  name: Record<string, string>;
}

export interface FeedbackSection {
  key: string;
  title: string;
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

/** POST /player/feedback */
export interface SubmitPlayerFeedbackDto {
  gameId: number;
  participantId: number;
  payload: PlayerAppFeedbackPayload;
}
