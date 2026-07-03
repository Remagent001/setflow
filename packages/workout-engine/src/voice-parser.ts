// Voice log parser (build doc section 7 + Segment 12).
// Turns a speech transcript like "75 for 10" into structured set data with
// a confidence score. Pure text logic - speech-to-text happens elsewhere
// (glasses mic, phone mic, or typed input); this never throws on weird
// input, it just returns intent "unknown" with low confidence.

import type { LogUnit, SetDifficulty } from "@setflow/shared";

export type VoiceIntent = "log" | "same_as_last" | "skip" | "difficulty" | "note" | "unknown";

export type ParsedVoiceLog = {
  intent: VoiceIntent;
  weight?: number;
  /** True for "bodyweight for 15"-style logs. */
  bodyweight?: boolean;
  reps?: number;
  unit?: "lb" | "kg";
  status?: "completed" | "failed";
  difficulty?: SetDifficulty;
  note?: string;
  /** 0..1 - how sure the parser is about its reading. */
  confidence: number;
  transcript: string;
};

// --- number words ------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

/**
 * Replace spoken numbers with digits: "seventy five" -> "75",
 * "a hundred and five" -> "105", and gym shorthand "two twenty five" -> "225".
 */
function wordsToDigits(text: string): string {
  const tokens = text.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] ?? "";
    const isNumberWord = (w?: string) =>
      w !== undefined && (w in UNITS || w in TENS || w === "hundred" || w === "a" || w === "and");
    if (!isNumberWord(t) || t === "and" || (t === "a" && tokens[i + 1] !== "hundred")) {
      out.push(t);
      i++;
      continue;
    }
    // Consume a run of number words.
    let value = 0;
    let current = 0;
    let consumed = 0;
    const parts: number[] = [];
    while (i < tokens.length) {
      const w = tokens[i] ?? "";
      if (w === "and") {
        i++;
        consumed++;
        continue;
      }
      if (w === "a" && tokens[i + 1] === "hundred") {
        current = 1;
        i++;
        consumed++;
        continue;
      }
      if (w === "hundred") {
        current = (current || 1) * 100;
        value += current;
        current = 0;
        i++;
        consumed++;
        continue;
      }
      if (w in TENS) {
        // "twenty five" - tens then maybe a unit.
        let n = TENS[w] ?? 0;
        const next = tokens[i + 1] ?? "";
        if (next in UNITS && (UNITS[next] ?? 0) < 10) {
          n += UNITS[next] ?? 0;
          i++;
          consumed++;
        }
        parts.push(n);
        i++;
        consumed++;
        continue;
      }
      if (w in UNITS) {
        parts.push(UNITS[w] ?? 0);
        i++;
        consumed++;
        continue;
      }
      break;
    }
    let total = value + current;
    if (parts.length === 2 && (parts[0] ?? 0) >= 1 && (parts[0] ?? 0) <= 9 && (parts[1] ?? 0) >= 20) {
      // Gym shorthand: "two twenty five" = 225, "one thirty five" = 135.
      total += (parts[0] ?? 0) * 100 + (parts[1] ?? 0);
    } else {
      total += parts.reduce((a, b) => a + b, 0);
    }
    if (consumed > 0) out.push(String(total));
    else {
      out.push(t);
      i++;
    }
  }
  return out.join(" ");
}

// --- difficulty vocabulary ----------------------------------------------------

const DIFFICULTY_WORDS: Array<[RegExp, SetDifficulty]> = [
  [/\b(brutal|killer|crushing|barely made it)\b/, "brutal"],
  [/\b(too heavy|really hard|very hard|tough|hard|heavy)\b/, "hard"],
  [/\b(moderate|okay|ok|fine|decent|solid)\b/, "moderate"],
  [/\b(too easy|easy|light|no problem)\b/, "easy"],
];

function findDifficulty(text: string): SetDifficulty | undefined {
  for (const [re, d] of DIFFICULTY_WORDS) {
    if (re.test(text)) return d;
  }
  return undefined;
}

// --- the parser ----------------------------------------------------------------

export function parseVoiceLog(rawTranscript: string): ParsedVoiceLog {
  const transcript = rawTranscript;
  const base = { transcript };
  const cleaned = rawTranscript
    .toLowerCase()
    .replace(/[,!?;:]/g, " ")
    .replace(/\.(?!\d)/g, " ") // strip periods except decimal points
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return { ...base, intent: "unknown", confidence: 0 };

  // "add note shoulder felt tight" - keep the note verbatim (post-normalize).
  const noteMatch = cleaned.match(/^(?:add |make |leave )?(?:a )?note[:\s]+(.+)$/);
  if (noteMatch?.[1]) {
    return { ...base, intent: "note", note: noteMatch[1].trim(), confidence: 0.95 };
  }

  if (/\bskip\b/.test(cleaned)) {
    return { ...base, intent: "skip", confidence: 0.95 };
  }

  if (/same (?:as )?(?:the )?last (?:set|one)|same weight|same again|same thing/.test(cleaned)) {
    return { ...base, intent: "same_as_last", confidence: 0.9 };
  }

  const text = wordsToDigits(cleaned);
  const difficulty = findDifficulty(text);
  const unit = /\b(kilos?|kgs?)\b/.test(text) ? ("kg" as const)
    : /\b(pounds?|lbs?)\b/.test(text) ? ("lb" as const)
    : undefined;

  // "failed at 8" - reps reached before failure.
  const failed = text.match(/\bfail(?:ed|ure)?(?: at)? (\d+(?:\.\d+)?)/);
  if (failed?.[1]) {
    return {
      ...base, intent: "log", reps: Number(failed[1]), status: "failed",
      difficulty, confidence: 0.9,
    };
  }
  if (/\bfail(?:ed|ure)?\b/.test(text)) {
    return { ...base, intent: "log", status: "failed", difficulty, confidence: 0.6 };
  }

  // "bodyweight for 15"
  const bw = text.match(/\bbody\s?weight(?: for)? (\d+(?:\.\d+)?)/);
  if (bw?.[1]) {
    return {
      ...base, intent: "log", bodyweight: true, reps: Number(bw[1]),
      status: "completed", difficulty, confidence: 0.95,
    };
  }

  // "75 for 10" / "75 pounds for 10" - the canonical form.
  const wFor = text.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|kilos?|kgs?)?\s*for\s*(\d+(?:\.\d+)?)/);
  if (wFor?.[1] && wFor[2]) {
    return {
      ...base, intent: "log", weight: Number(wFor[1]), reps: Number(wFor[2]),
      unit, status: "completed", difficulty, confidence: 0.95,
    };
  }

  // "75 pounds 10 reps" / "75 pounds times 10"
  const wUnitReps = text.match(
    /(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|kilos?|kgs?)\s*(?:by|times|x)?\s*(\d+(?:\.\d+)?)(?:\s*reps?)?/
  );
  if (wUnitReps?.[1] && wUnitReps[2]) {
    return {
      ...base, intent: "log", weight: Number(wUnitReps[1]), reps: Number(wUnitReps[2]),
      unit, status: "completed", difficulty, confidence: 0.9,
    };
  }

  // "75 by 10" / "75 x 10"
  const wBy = text.match(/(\d+(?:\.\d+)?)\s*(?:by|times|x)\s*(\d+(?:\.\d+)?)/);
  if (wBy?.[1] && wBy[2]) {
    return {
      ...base, intent: "log", weight: Number(wBy[1]), reps: Number(wBy[2]),
      unit, status: "completed", difficulty, confidence: 0.85,
    };
  }

  // "10 reps" - reps only, weight comes from context.
  const repsOnly = text.match(/(\d+(?:\.\d+)?)\s*reps?\b/);
  if (repsOnly?.[1]) {
    return {
      ...base, intent: "log", reps: Number(repsOnly[1]),
      status: "completed", difficulty, confidence: 0.75,
    };
  }

  // Two bare numbers: probably "weight reps", but it's a guess.
  const twoBare = text.match(/^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)$/);
  if (twoBare?.[1] && twoBare[2]) {
    return {
      ...base, intent: "log", weight: Number(twoBare[1]), reps: Number(twoBare[2]),
      status: "completed", difficulty, confidence: 0.6,
    };
  }

  // A single bare number: rep-range numbers read as reps, big ones as weight.
  const oneBare = text.match(/^(\d+(?:\.\d+)?)$/);
  if (oneBare?.[1]) {
    const n = Number(oneBare[1]);
    return n <= 30
      ? { ...base, intent: "log", reps: n, status: "completed", confidence: 0.45 }
      : { ...base, intent: "log", weight: n, status: "completed", confidence: 0.45 };
  }

  // Pure difficulty remark ("that was brutal").
  if (difficulty) {
    return { ...base, intent: "difficulty", difficulty, confidence: 0.85 };
  }

  return { ...base, intent: "unknown", confidence: 0.1 };
}

// --- resolution against workout context ------------------------------------------

export type VoiceLogContext = {
  /** What the wearer last logged for this exercise, if anything. */
  lastWeight?: number;
  lastReps?: number;
  /** The plan's targets (after any session override). */
  targetWeight?: number;
  targetReps?: number;
  unit: LogUnit;
};

export type ResolvedVoiceLog =
  | {
      action: "pending";
      pending: {
        weight?: number;
        reps?: number;
        unit: LogUnit;
        status?: "completed" | "failed";
        difficulty?: SetDifficulty;
        note?: string;
        transcript?: string;
        confidence?: number;
      };
    }
  | { action: "skip" }
  | { action: "difficulty"; difficulty: SetDifficulty }
  | { action: "note"; note: string }
  | { action: "unclear"; confidence: number };

/**
 * Fill a parsed log's gaps from workout context ("same as last set", bare
 * "10 reps" at the current weight) so the engine gets a complete PendingLog.
 */
export function resolveVoiceLog(parsed: ParsedVoiceLog, ctx: VoiceLogContext): ResolvedVoiceLog {
  switch (parsed.intent) {
    case "skip":
      return { action: "skip" };
    case "note":
      return parsed.note ? { action: "note", note: parsed.note } : { action: "unclear", confidence: parsed.confidence };
    case "difficulty":
      return parsed.difficulty
        ? { action: "difficulty", difficulty: parsed.difficulty }
        : { action: "unclear", confidence: parsed.confidence };
    case "same_as_last": {
      const weight = ctx.lastWeight ?? ctx.targetWeight;
      const reps = ctx.lastReps ?? ctx.targetReps;
      if (weight === undefined && reps === undefined) {
        return { action: "unclear", confidence: parsed.confidence };
      }
      return {
        action: "pending",
        pending: {
          weight, reps, unit: ctx.unit, status: "completed",
          transcript: parsed.transcript, confidence: parsed.confidence,
        },
      };
    }
    case "log": {
      const unit: LogUnit = parsed.bodyweight ? "bodyweight" : (parsed.unit ?? ctx.unit);
      const weight = parsed.bodyweight ? undefined : (parsed.weight ?? ctx.lastWeight ?? ctx.targetWeight);
      const reps = parsed.reps ?? ctx.targetReps;
      return {
        action: "pending",
        pending: {
          weight, reps, unit,
          status: parsed.status ?? "completed",
          difficulty: parsed.difficulty,
          transcript: parsed.transcript,
          confidence: parsed.confidence,
        },
      };
    }
    default:
      return { action: "unclear", confidence: parsed.confidence };
  }
}
