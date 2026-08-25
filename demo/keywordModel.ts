import { CompletionRequest, ModelClient } from "../src/core/planner/modelClient";

/**
 * A deterministic, dependency-free stand-in for the on-device LLM's labeling
 * step. The real extension runs a ~1 GB model to map each form question to a
 * canonical label; here we answer positionally by keyword so the demo (and the
 * integration harness) stay fully offline and reproducible. First matching rule
 * wins; specific rules precede general ones. A few rules deliberately INVENT
 * non-seed labels (GPA / essay / major) so the label-invention path is exercised.
 * Everything unmatched is UNKNOWN — the matcher then derives a question-based
 * label, mirroring a real red field.
 */
const RULES: [RegExp, string][] = [
  [/linkedin/, "LINKEDIN"],
  // Emergency-contact rules precede PHONE/NAME so "Emergency contact phone/name"
  // don't fall to PHONE/FULL_NAME. Phone-specific first.
  [/emergency contact (phone|number)/, "EMERGENCY_CONTACT_PHONE"],
  [/emergency/, "EMERGENCY_CONTACT"],
  [/e-?mail/, "EMAIL"],
  [/first name|given name/, "FIRST_NAME"],
  [/last name|surname|family name/, "LAST_NAME"],
  [/full name|legal name|\byour name\b/, "FULL_NAME"],
  [/phone|mobile|\btel\b/, "PHONE"],
  [/date of birth|\bdob\b|birth ?date/, "DATE_OF_BIRTH"],
  [/check-?in|arrival|pick-?up|\bembark|tour start|appointment date|event date|start date/, "START_DATE"],
  [/check-?out|departure|return|drop-?off|disembark|end date/, "END_DATE"],
  [/apartment|apt\b|suite|unit|address line 2/, "ADDRESS_LINE_2"],
  [/street|\baddress\b/, "STREET_ADDRESS"],
  [/\bcity\b|town/, "CITY"],
  [/state|province/, "STATE"],
  [/\bzip\b|postal/, "POSTAL_CODE"],
  [/country/, "COUNTRY"],
  // Overlap clusters (invented labels the different forms phrase differently).
  [/goals|objectives|mission|aim to achieve/, "COMPANY_GOALS"],
  [/number of employees|team size|how many.*employ/, "EMPLOYEE_COUNT"],
  [/years in (business|operation)|how long.*operat/, "YEARS_IN_BUSINESS"],
  [/annual revenue|gross annual|yearly gross|\brevenue\b/, "ANNUAL_REVENUE"],
  [/\bein\b|employer identification|federal tax id|tax id/, "TAX_ID"],
  [/dietary|allerg/, "DIETARY_RESTRICTIONS"],
  [/guest|occupant|passenger|party size|attendee|number of people|group size|headcount/, "NUM_PEOPLE"],
  [/room type/, "ROOM_TYPE"],
  [/special request|comments|\bnotes\b/, "SPECIAL_REQUESTS"],
  [/\btime\b/, "TIME"],
  [/company|employer|organi[sz]ation|business name/, "COMPANY"],
  [/job title|position|desired role|\brole\b/, "JOB_TITLE"],
  [/website|homepage|portfolio|\burl\b/, "WEBSITE"],
  [/cover letter/, "COVER_LETTER"],
  [/passport/, "PASSPORT_NUMBER"],
  [/card number|credit card/, "CARD_NUMBER"],
  // Invented (non-seed) labels — realistic for these fixtures, absent from the vocab.
  [/\bgpa\b/, "CUMULATIVE_GPA"],
  [/essay/, "PERSONAL_ESSAY"],
  [/major|field of study/, "INTENDED_MAJOR"],
  [/\bname\b/, "FULL_NAME"],
];

/** Map one form question to a canonical (or plausibly invented) label. */
export function labelForQuestion(question: string): string {
  const q = question.toLowerCase();
  for (const [re, label] of RULES) if (re.test(q)) return label;
  return "UNKNOWN";
}

/**
 * Recover the numbered questions the matcher put in the labeling prompt so the
 * stand-in can answer them in order (buildLabelPrompt formats them as "N.
 * question"). Positions by the prompt's OWN number so an empty question ("N. ")
 * keeps its slot and doesn't shift every later label — matching a real model,
 * which answers all N in order. An empty slot → "" → UNKNOWN.
 */
export function parseQuestions(req: CompletionRequest): string[] {
  const content = req.messages.map((m) => m.content).join("\n");
  const byNumber: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^\s*(\d+)\.\s?(.*?)\s*$/.exec(line);
    if (m) byNumber[Number(m[1]) - 1] = m[2]!;
  }
  return Array.from(byNumber, (q) => q ?? "");
}

/**
 * A pure, offline ModelClient: it reads the questions out of the labeling prompt
 * and returns a JSON array of labels (one per question, in order) via the keyword
 * map. No network, no timers, no test framework — this is the exact model the
 * deployed demo runs in place of the on-device LLM.
 */
export function makeKeywordModel(): ModelClient {
  return {
    async complete<T>(req: CompletionRequest): Promise<T> {
      return parseQuestions(req).map(labelForQuestion) as T;
    },
  };
}
