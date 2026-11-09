import { z } from "zod";

export const MailboxSettingsSchema = z.object({
	fromName: z.string().optional(),
	forwarding: z
		.object({
			enabled: z.boolean().optional(),
			email: z.string().optional(),
			spam: z.boolean().optional(),
			internal: z.boolean().optional(),
		})
		.optional(),
	signature: z
		.object({ enabled: z.boolean().optional(), text: z.string().optional(), html: z.string().optional() })
		.optional(),
	autoReply: z
		.object({ enabled: z.boolean().optional(), subject: z.string().optional(), message: z.string().optional() })
		.optional(),
	agentSystemPrompt: z.string().optional(),
});

export type MailboxSettings = z.infer<typeof MailboxSettingsSchema>;
export type SignatureSettings = NonNullable<MailboxSettings["signature"]>;

export function parseMailboxSettings(value: unknown): MailboxSettings | null {
	const result = MailboxSettingsSchema.safeParse(value);
	return result.success ? result.data : null;
}
