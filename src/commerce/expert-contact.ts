import type { CommerceChatResponse } from "./contracts.js";

export const MUDITAM_EXPERT_PHONE_DISPLAY = "8989174741";
export const MUDITAM_EXPERT_PHONE_E164 = "+918989174741";
export const MUDITAM_EXPERT_WHATSAPP_URL = "https://api.whatsapp.com/send?phone=919625368707&text=Hi%0AI%20would%20like%20to%20connect%20to%20an%20expert";

export function expertHandoff(
  queue: NonNullable<CommerceChatResponse["handoff"]>["queue"],
  reason: string,
): NonNullable<CommerceChatResponse["handoff"]> {
  return {
    queue,
    reason,
    phoneDisplay: MUDITAM_EXPERT_PHONE_DISPLAY,
    phoneHref: `tel:${MUDITAM_EXPERT_PHONE_E164}`,
    whatsappUrl: MUDITAM_EXPERT_WHATSAPP_URL,
  };
}
