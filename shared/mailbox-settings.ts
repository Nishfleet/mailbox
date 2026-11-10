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

const StoredMailboxSettingsSchema = z.object({
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

export type StoredMailboxSettings = z.infer<typeof StoredMailboxSettingsSchema>;

export function parseMailboxSettings(value: unknown): StoredMailboxSettings | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const stored = value as Record<string, unknown>;
	const settings: Record<string, unknown> = {};
	for (const [key, schema] of Object.entries(StoredMailboxSettingsSchema.shape)) {
		const result = schema.safeParse(stored[key]);
		if (result.success && result.data !== undefined) settings[key] = result.data;
	}
	return settings;
}
