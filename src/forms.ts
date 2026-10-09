import * as v from "valibot";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./auth/password.ts";

export const CURRENCIES = ["USD", "PEN"] as const;
export type Currency = (typeof CURRENCIES)[number];

// Decimal text to the minor unit, without floating point. Two decimals at most.
export function parseMoney(text: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return minor > 0 ? minor : null;
}

export function formatMoney(minor: number, currency: string): string {
  const amount = (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

export const emailField = v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.maxLength(254),
  v.email("Enter a valid email."),
);

const password = v.pipe(
  v.string(),
  v.minLength(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
  v.maxLength(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`),
);

const money = (label: string) =>
  v.pipe(
    v.string(),
    v.transform((text) => parseMoney(text)),
    v.number(`${label} must be a positive amount with at most two decimals.`),
  );

export const registerForm = v.object({
  email: emailField,
  password,
  role: v.picklist(["seller", "funder"], "Choose seller or funder."),
});

export const resetForm = v.object({ password });

export const listingForm = v.pipe(
  v.object({
    debtorName: v.pipe(v.string(), v.trim(), v.minLength(1, "Enter the debtor."), v.maxLength(200)),
    currency: v.picklist(CURRENCIES, "Choose a currency."),
    faceValue: money("Face value"),
    askingPrice: money("Asking price"),
    dueDate: v.pipe(v.string(), v.check(isCalendarDate, "Enter the due date as YYYY-MM-DD.")),
  }),
  v.forward(
    v.check((f) => f.askingPrice <= f.faceValue, "The asking price cannot exceed the face value."),
    ["askingPrice"],
  ),
);

export const offerForm = v.object({ amount: money("Offer") });

// The sign-in form is not validated beyond shape. Any string that is not a real credential fails
// the same way, and a stricter check would tell an attacker which emails are well formed.
export const loginForm = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(254)),
  password: v.pipe(v.string(), v.maxLength(MAX_PASSWORD_LENGTH)),
});

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseForm<S extends v.GenericSchema>(
  schema: S,
  body: unknown,
): ParseResult<v.InferOutput<S>> {
  const result = v.safeParse(schema, body);
  if (result.success) return { ok: true, value: result.output };
  return { ok: false, message: result.issues[0]?.message ?? "Check the form." };
}
