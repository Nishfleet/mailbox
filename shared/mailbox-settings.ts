import { z } from "zod";

export const MailboxSettingsSchema = z.object({
	fromName: z.string().optional(),
	forwarding: z
		.object({
			enabled: z.boolean(),
			email: z.string(),
			spam: z.boolean().optional(),
			internal: z.boolean().optional(),
		})
		.optional(),
	signature: z
		.object({ enabled: z.boolean(), text: z.string(), html: z.string().optional() })
		.optional(),
	autoReply: z
		.object({ enabled: z.boolean(), subject: z.string(), message: z.string() })
		.optional(),
	agentSystemPrompt: z.string().optional(),
});

export type MailboxSettings = z.infer<typeof MailboxSettingsSchema>;
export type SignatureSettings = NonNullable<MailboxSettings["signature"]>;
