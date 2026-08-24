import { CronExpressionParser } from "cron-parser";

export function nextCronOccurrence(
  expression: string,
  timezone: string | null,
  currentDate: Date
): Date {
  const parser = CronExpressionParser.parse(expression, {
    ...(timezone ? { tz: timezone } : {}),
    currentDate
  });
  const next = parser.next().toDate();
  if (next <= currentDate) throw new Error("Cron parser returned a non-future occurrence");
  return next;
}
