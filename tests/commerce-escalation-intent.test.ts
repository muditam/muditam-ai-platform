import { describe, expect, it } from "vitest";
import { explicitlyRequestsHumanSupport } from "../src/commerce/analytics-store.js";

describe("commerce escalation intent", () => {
  it.each([
    "Please connect me to support",
    "I want to talk to a human agent",
    "Can I speak with your dietitian?",
    "WhatsApp customer support",
    "Have someone from your team call me",
    "mujhe support se baat karni hai",
    "I need human support",
  ])("counts an explicit human-support request as escalation: %s", (message) => {
    expect(explicitlyRequestsHumanSupport(message)).toBe(true);
  });

  it.each([
    "I need a refund",
    "Can I take this during pregnancy?",
    "Any product for liver?",
    "I cannot find the dosage",
    "Where is my order?",
    "My product is missing",
    "Is this safe?",
  ])("does not treat an automatic support-card fallback as escalation: %s", (message) => {
    expect(explicitlyRequestsHumanSupport(message)).toBe(false);
  });
});
