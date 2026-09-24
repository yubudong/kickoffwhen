import argon2 from "argon2";

function assertSixDigitPin(pin: string) {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("PIN_MUST_BE_6_DIGITS");
  }
}

export function hashParentPin(pin: string) {
  assertSixDigitPin(pin);
  return argon2.hash(pin, { type: argon2.argon2id });
}

export function hashChildPin(pin: string) {
  assertSixDigitPin(pin);
  return argon2.hash(pin, { type: argon2.argon2id });
}

export function verifyPinHash(hash: string, pin: string) {
  return argon2.verify(hash, pin);
}
