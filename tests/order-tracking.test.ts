import { describe, expect, it } from "vitest";
import { answerCommerceChat } from "../src/commerce/commerce-engine.js";
import { deterministicOrderTracking, orderTrackingIntent, trackingLookupInput } from "../src/commerce/order-tracking.js";

const request = {
  conversationId: "commerce-conversation-1",
  visitorId: "visitor-1",
  channel: "shopify_web" as const,
  language: "en" as const,
  message: "Where is my order?",
  recentMessages: [],
};

describe("commerce order tracking", () => {
  it("routes an order cancellation directly to support without collecting identifiers", async () => {
    let lookupCalled = false;
    const result = await deterministicOrderTracking({
      ...request,
      message: "can you cancel my ordeR?",
    }, async () => {
      lookupCalled = true;
      return "NOT_FOUND";
    });
    expect(lookupCalled).toBe(false);
    expect(result?.decision).toBe("HANDOFF");
    expect(result?.messages[0]?.text).toBe("I can only help you check your order status. To cancel or modify an order, please connect with our support team by call or WhatsApp.");
    expect(result?.handoff?.queue).toBe("support");
  });

  for (const message of [
    "change the delivery address on my order",
    "remove one product from my order",
    "can you reschedule my delivery date?",
    "I want to exchange an item in my order",
  ]) {
    it(`routes an order modification directly to support: ${message}`, async () => {
      let lookupCalled = false;
      const result = await deterministicOrderTracking({ ...request, message }, async () => {
        lookupCalled = true;
        return "NOT_FOUND";
      });
      expect(lookupCalled).toBe(false);
      expect(result?.decision).toBe("HANDOFF");
      expect(result?.handoff?.queue).toBe("support");
      expect(result?.messages[0]?.text).toContain("only help you check your order status");
    });
  }

  it("recognizes English and Hinglish tracking questions", () => {
    expect(orderTrackingIntent(request)).toBe(true);
    expect(orderTrackingIntent({ ...request, message: "i need my order details" })).toBe(true);
    expect(orderTrackingIntent({ ...request, message: "mera order kaha hai?" })).toBe(true);
    expect(orderTrackingIntent({ ...request, message: "9557704466" })).toBe(true);
    expect(orderTrackingIntent({ ...request, message: "customer@example.com" })).toBe(true);
  });

  it("collects an order number and checkout phone over multiple turns", () => {
    const parsed = trackingLookupInput({
      ...request,
      message: "9876543210",
      recentMessages: [
        { role: "user", content: "Track my order" },
        { role: "assistant", content: "Please share your order number." },
        { role: "user", content: "#ma150237" },
        { role: "assistant", content: "Please share the checkout phone or email." },
      ],
    });
    expect(parsed).toEqual({ orderName: "#MA150237", email: null, phone: "9876543210" });
  });

  it("prefers a newly supplied phone number over an older number", () => {
    const parsed = trackingLookupInput({
      ...request,
      message: "+919876543210",
      recentMessages: [
        { role: "user", content: "My number is +918438338347" },
        { role: "assistant", content: "Please share the correct registered mobile number or order ID." },
      ],
    });
    expect(parsed.phone).toBe("9876543210");
  });

  it("clears an old phone when the customer asks to use another number", async () => {
    const replacementRequest = {
      ...request,
      message: "another number",
      recentMessages: [
        { role: "user" as const, content: "9557704466" },
        { role: "assistant" as const, content: "I couldn’t verify that order with those details." },
      ],
    };
    expect(orderTrackingIntent(replacementRequest)).toBe(true);
    const prompt = await deterministicOrderTracking(replacementRequest, async () => {
      throw new Error("lookup should not run until the replacement identifier is supplied");
    });
    expect(prompt?.messages[0]?.text).toContain("correct registered mobile number or order ID");

    const parsed = trackingLookupInput({
      ...request,
      message: "#MA150516",
      recentMessages: [
        { role: "user", content: "9557704466" },
        { role: "assistant", content: "I couldn’t verify that order with those details." },
        { role: "user", content: "another number" },
        { role: "assistant", content: "No problem. Please share the correct registered mobile number or order ID." },
      ],
    });
    expect(parsed).toEqual({ orderName: "#MA150516", email: null, phone: null });
  });

  it("releases the order flow when the customer switches to a product question", async () => {
    const switchedRequest = {
      ...request,
      message: "what product should i take for diabetes?",
      recentMessages: [
        { role: "user" as const, content: "+918438338347" },
        { role: "assistant" as const, content: "Thanks, I found your latest order. Your order number is #MA150128. Your order has been delivered." },
      ],
    };
    let lookupCalled = false;
    expect(orderTrackingIntent(switchedRequest)).toBe(false);
    expect(await deterministicOrderTracking(switchedRequest, async () => {
      lookupCalled = true;
      return "NOT_FOUND";
    })).toBeNull();
    expect(lookupCalled).toBe(false);
  });

  it("verifies every referenced order independently when the customer asks for both", async () => {
    const result = await deterministicOrderTracking({
      ...request,
      message: "both",
      recentMessages: [
        { role: "user", content: "Please check #MA150365 and #MA147126" },
        { role: "assistant", content: "Please share your registered mobile number or email so I can verify both orders." },
        { role: "user", content: "+918438338347" },
        { role: "assistant", content: "Would you like the status of #MA150365 or #MA147126?" },
      ],
    }, async ({ orderName }) => ({
      orderName: orderName ?? "",
      status: orderName === "#MA147126" ? "Delivered" : "Confirmed, awaiting shipment",
      statusDetail: orderName === "#MA147126"
        ? "Your order has been delivered."
        : "Your order has not shipped yet. Once it is dispatched, you’ll receive the tracking number and tracking link.",
      productNames: [orderName === "#MA147126" ? "Karela Jamun Fizz" : "Nerve Fix"],
      placedAt: "2026-08-20T08:00:00.000Z",
      courier: orderName === "#MA147126" ? "BLUEDART" : null,
      trackingNumberMasked: null,
      currentLocation: null,
      expectedDeliveryDate: null,
      latestEventAt: null,
    }));
    expect(result?.orderTrackings).toHaveLength(2);
    expect(result?.messages[0]?.text).toContain("#MA150365");
    expect(result?.messages[0]?.text).toContain("has not shipped yet");
    expect(result?.messages[0]?.text).toContain("#MA147126");
    expect(result?.messages[0]?.text).toContain("has been delivered");
  });

  it("does not display an order that fails customer identity verification", async () => {
    const result = await deterministicOrderTracking({
      ...request,
      message: "both",
      recentMessages: [
        { role: "user", content: "Check #MA150362 and #MA150365 for +919999999999" },
        { role: "assistant", content: "I’ll verify both orders." },
      ],
    }, async ({ orderName }) => orderName === "#MA150362" ? "IDENTITY_MISMATCH" : {
      orderName: "#MA150365",
      status: "Confirmed, awaiting shipment",
      statusDetail: "Your order has not shipped yet.",
      productNames: ["Karela Jamun Fizz"],
      placedAt: "2026-08-20T08:00:00.000Z",
      courier: null,
      trackingNumberMasked: null,
      currentLocation: null,
      expectedDeliveryDate: null,
      latestEventAt: null,
    });
    expect(result?.orderTrackings?.map((item) => item.orderName)).toEqual(["#MA150365"]);
    expect(result?.messages[0]?.text).not.toContain("#MA150362");
  });

  it("returns older delivered orders when a verified customer asks for all orders", async () => {
    let singleLookupCalled = false;
    const makeOrder = (orderName: string, status: string) => ({
      orderName,
      status,
      statusDetail: status === "Delivered" ? "Your order has been delivered." : "Your order has not shipped yet.",
      productNames: ["Karela Jamun Fizz"],
      placedAt: "2026-08-20T08:00:00.000Z",
      courier: status === "Delivered" ? "BLUEDART" : null,
      trackingNumberMasked: null,
      currentLocation: null,
      expectedDeliveryDate: null,
      latestEventAt: null,
    });
    const result = await deterministicOrderTracking({
      ...request,
      message: "+918438338347",
      recentMessages: [
        { role: "user", content: "show all my orders" },
        { role: "assistant", content: "Please share your registered mobile number or order ID." },
      ],
    }, async () => {
      singleLookupCalled = true;
      return "NOT_FOUND";
    }, async ({ phone }) => {
      expect(phone).toBe("8438338347");
      return [
        makeOrder("#MA150362", "Confirmed, awaiting shipment"),
        makeOrder("#MA150365", "Confirmed, awaiting shipment"),
        makeOrder("#MA147126", "Delivered"),
      ];
    });
    expect(singleLookupCalled).toBe(false);
    expect(result?.orderTrackings?.map((item) => item.orderName)).toEqual(["#MA150362", "#MA150365", "#MA147126"]);
    expect(result?.messages[0]?.text).toContain("#MA147126");
    expect(result?.messages[0]?.text).toContain("has been delivered");
  });

  it("asks for a registered mobile number or order ID before querying ShipTrack", async () => {
    let called = false;
    const result = await deterministicOrderTracking(request, async () => {
      called = true;
      return "NOT_FOUND";
    });
    expect(called).toBe(false);
    expect(result?.messages[0]?.text).toContain("registered mobile number or order ID");
    expect(result?.usage.totalTokens).toBe(0);
  });

  it("can retrieve the latest order using only a checkout phone number", async () => {
    let received: { orderName: string | null; email: string | null; phone: string | null } | null = null;
    const result = await deterministicOrderTracking({
      ...request,
      message: "9876543210",
      recentMessages: [
        { role: "user", content: "Where is my order?" },
        { role: "assistant", content: "Please share your order number, checkout phone number, or email." },
      ],
    }, async (lookup) => {
      received = lookup;
      return {
        orderName: "#MA150237", status: "In transit", courier: "BLUEDART",
        statusDetail: "Your order is on the way with BLUEDART.",
        productNames: ["Karela Jamun Fizz"],
        placedAt: "2026-08-20T08:00:00.000Z",
        trackingNumberMasked: "••••5431", currentLocation: null,
        expectedDeliveryDate: null, latestEventAt: null,
      };
    });
    expect(received).toEqual({ orderName: null, email: null, phone: "9876543210" });
    expect(result?.orderTracking?.orderName).toBe("#MA150237");
  });

  it("keeps a bare phone number in the verified order flow even when the prompt wording changes", async () => {
    let received: { orderName: string | null; email: string | null; phone: string | null } | null = null;
    const followUp = {
      ...request,
      message: "9557704466",
      recentMessages: [
        { role: "user" as const, content: "Can you pull up my latest shipment?" },
        { role: "assistant" as const, content: "I can look up your delivery securely. What contact number did you use at checkout?" },
      ],
    };

    expect(orderTrackingIntent(followUp)).toBe(true);
    const result = await deterministicOrderTracking(followUp, async (lookup) => {
      received = lookup;
      return "NOT_FOUND";
    });

    expect(received).toEqual({ orderName: null, email: null, phone: "9557704466" });
    expect(result?.messages[0]?.text).toContain("couldn’t verify");
    expect(result?.messages[0]?.text).toContain("connect with Muditam support");
    expect(result?.handoff?.queue).toBe("support");
    expect(result?.handoff?.phoneDisplay).toBe("8989174741");
    expect(result?.orderTracking).toBeNull();
  });

  it("does not reveal an order when customer verification fails", async () => {
    const result = await deterministicOrderTracking({ ...request, message: "Track #MA150237, phone 9876543210" }, async () => "IDENTITY_MISMATCH");
    expect(result?.orderTracking).toBeNull();
    expect(result?.messages[0]?.text).toContain("couldn’t verify");
  });

  it("clears the previous identifier when the customer says it was wrong", async () => {
    let lookupCalled = false;
    const result = await deterministicOrderTracking({
      ...request,
      message: "sorry this number is wrong",
      recentMessages: [
        { role: "user", content: "i need my order details" },
        { role: "assistant", content: "Please share your registered mobile number or order ID." },
        { role: "user", content: "+918438338347" },
        { role: "assistant", content: "Thanks, I found your latest order. Your order number is #MA150349." },
      ],
    }, async () => {
      lookupCalled = true;
      return "NOT_FOUND";
    });
    expect(lookupCalled).toBe(false);
    expect(result?.messages[0]?.text).toBe("No problem. Please share the correct registered mobile number or order ID.");
    expect(result?.orderTracking).toBeNull();
  });

  it("returns a structured tracking card without calling the model", async () => {
    let modelCalled = false;
    const result = await answerCommerceChat(
      { ...request, message: "Track #MA150237 using 9876543210" },
      { answer: async () => {
        modelCalled = true;
        throw new Error("model should not be called");
      } },
      async () => [],
      async () => ({
        orderName: "#MA150237",
        status: "In transit",
        statusDetail: "Your order is on the way with BLUEDART.",
        productNames: ["Karela Jamun Fizz"],
        placedAt: "2026-08-20T08:00:00.000Z",
        courier: "BLUEDART",
        trackingNumberMasked: "••••5431",
        currentLocation: "Delhi",
        expectedDeliveryDate: null,
        latestEventAt: "2026-08-20T10:00:00.000Z",
      }),
    );
    expect(modelCalled).toBe(false);
    expect(result.orderTracking?.status).toBe("In transit");
    expect(result.orderTracking?.trackingNumberMasked).toBe("••••5431");
    expect(result.usage.totalTokens).toBe(0);
  });

  it("keeps an order-details conversation in lookup and returns a useful latest-order answer", async () => {
    let modelCalled = false;
    const first = await answerCommerceChat(
      { ...request, message: "i need my order details" },
      { answer: async () => { modelCalled = true; throw new Error("model should not be called"); } },
      async () => [],
      async () => "NOT_FOUND",
    );
    expect(first.messages[0]?.text).toContain("registered mobile number");
    expect(first.handoff).toBeNull();

    const second = await answerCommerceChat(
      {
        ...request,
        message: "+918438338347",
        recentMessages: [
          { role: "user", content: "i need my order details" },
          { role: "assistant", content: first.messages[0]?.text ?? "" },
        ],
      },
      { answer: async () => { modelCalled = true; throw new Error("model should not be called"); } },
      async () => [],
      async () => ({
        orderName: "#MA150349",
        status: "Confirmed, awaiting shipment",
        statusDetail: "Your order has not shipped yet. Once it is dispatched, you’ll receive the tracking number and tracking link.",
        productNames: ["Karela Jamun Fizz"],
        placedAt: "2026-08-20T08:00:00.000Z",
        courier: null,
        trackingNumberMasked: null,
        currentLocation: null,
        expectedDeliveryDate: null,
        latestEventAt: null,
      }),
    );
    expect(modelCalled).toBe(false);
    expect(second.messages[0]?.text).toContain("#MA150349");
    expect(second.messages[0]?.text).toContain("Karela Jamun Fizz");
    expect(second.messages[0]?.text).toContain("20 August 2026");
    expect(second.messages[0]?.text).toContain("has not shipped yet");
    expect(second.handoff).toBeNull();
  });
});
