// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Badge,
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	ArrowRightIcon,
	CheckCircleIcon,
	ClockIcon,
	EnvelopeIcon,
	FileTextIcon,
	HandCoinsIcon,
	LightningIcon,
	PlusIcon,
	TrashIcon,
	UsersIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { formatListDate } from "shared/dates";
import api from "~/services/api";
import { useAttentionSummary } from "~/queries/attention";
import {
	useCreateMailbox,
	useDeleteMailbox,
	useMailboxes,
} from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";
import type {
	AttentionBucket,
	AttentionBucketId,
	AttentionItem,
	AttentionNextAction,
} from "~/types";

export function meta() {
	return [{ title: "Agentic Inbox" }];
}

function MailboxPendingStatus({ count }: { count?: number | null }) {
	if (count === undefined) {
		return (
			<span className="whitespace-nowrap text-xs font-medium text-kumo-subtle">
				Checking...
			</span>
		);
	}

	if (count === null) {
		return (
			<span className="whitespace-nowrap text-xs font-medium text-kumo-subtle">
				Unavailable
			</span>
		);
	}

	if (count > 0) {
		return (
			<Badge variant="secondary">
				{count === 1 ? "1 pending" : `${count} pending`}
			</Badge>
		);
	}

	return (
		<span className="whitespace-nowrap text-xs font-medium text-kumo-subtle">
			No pending
		</span>
	);
}

const BUCKET_ICONS: Record<AttentionBucketId, ReactNode> = {
	act_now: <LightningIcon size={16} weight="bold" />,
	money: <HandCoinsIcon size={16} weight="bold" />,
	leads: <UsersIcon size={16} weight="bold" />,
	aging: <ClockIcon size={16} weight="bold" />,
	drafts_ready: <FileTextIcon size={16} weight="bold" />,
};

const BUCKET_FOLDER: Record<AttentionBucketId, string> = {
	act_now: "inbox",
	money: "inbox",
	leads: "inbox",
	aging: "inbox",
	drafts_ready: "draft",
};

function AttentionBucketRow({ bucket }: { bucket: AttentionBucket }) {
	const topItem = bucket.topItems[0];
	const targetMailbox = topItem?.mailboxId;
	const targetFolder = topItem?.folderId || BUCKET_FOLDER[bucket.id];
	const row = (
		<div className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-kumo-tint">
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-kumo-default">
				{BUCKET_ICONS[bucket.id]}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold text-kumo-default">
						{bucket.label}
					</span>
					{bucket.count > 0 && (
						<Badge variant="secondary">
							{bucket.count}
						</Badge>
					)}
				</div>
				<div className="truncate text-xs text-kumo-subtle">
					{topItem
						? `${topItem.mailboxId} · ${topItem.reason}`
						: bucket.description}
				</div>
			</div>
			{targetMailbox && (
				<ArrowRightIcon
					size={16}
					className="shrink-0 text-kumo-subtle"
				/>
			)}
		</div>
	);

	if (!targetMailbox) return row;

	return (
		<RouterLink
			to={`/mailbox/${targetMailbox}/emails/${targetFolder}`}
			className="block no-underline"
		>
			{row}
		</RouterLink>
	);
}

function AttentionItemRow({ item }: { item: AttentionItem }) {
	return (
		<RouterLink
			to={`/mailbox/${item.mailboxId}/emails/${item.folderId}`}
			className="flex items-center gap-3 rounded-md px-3 py-2 no-underline transition-colors hover:bg-kumo-tint"
		>
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-kumo-default">
				{BUCKET_ICONS[item.bucket]}
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium text-kumo-default">
					{item.subject}
				</div>
				<div className="truncate text-xs text-kumo-subtle">
					{item.mailboxId} · {item.sender || item.recipient} · {item.reason}
				</div>
			</div>
			<div className="shrink-0 text-xs text-kumo-subtle">
				{formatListDate(item.date)}
			</div>
		</RouterLink>
	);
}

function attentionActionHref(action: AttentionNextAction) {
	const params = new URLSearchParams({ email: action.emailId });
	if (action.threadId) params.set("thread", action.threadId);
	return `/mailbox/${action.mailboxId}/emails/${action.folderId}?${params}`;
}

function AttentionNextActionRow({ action }: { action: AttentionNextAction }) {
	return (
		<RouterLink
			to={attentionActionHref(action)}
			className="flex min-h-16 items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-kumo-tint"
		>
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-kumo-default">
				{BUCKET_ICONS[action.bucket]}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold text-kumo-default">
						{action.label}
					</span>
					<span className="shrink-0 text-xs text-kumo-subtle">
						{action.mailboxId}
					</span>
				</div>
				<div className="truncate text-xs text-kumo-subtle">
					{action.description}
				</div>
				<div className="truncate text-xs text-kumo-subtle">
					{action.subject} · {action.reason}
				</div>
			</div>
			<ArrowRightIcon size={16} className="shrink-0 text-kumo-subtle" />
		</RouterLink>
	);
}

function AttentionDesk() {
	const {
		data: attention,
		isLoading,
		isError,
	} = useAttentionSummary();

	if (isLoading) {
		return (
			<div className="mb-6 rounded-xl border border-kumo-line bg-kumo-base p-5">
				<div className="flex items-center gap-3">
					<Loader size="sm" />
					<span className="text-sm font-medium text-kumo-subtle">
						Checking all mailboxes...
					</span>
				</div>
			</div>
		);
	}

	if (isError || !attention) {
		return (
			<div className="mb-6 rounded-xl border border-kumo-line bg-kumo-base p-5">
				<div className="flex items-center gap-3 text-kumo-subtle">
					<WarningCircleIcon size={18} />
					<span className="text-sm font-medium">
						Attention check unavailable
					</span>
				</div>
			</div>
		);
	}

	const hasAttention = attention.buckets.some((bucket) => bucket.count > 0);
	const unavailableMailboxes = attention.mailboxes.filter(
		(mailbox) => mailbox.status === "unavailable",
	);
	const hasUnknown =
		attention.mailboxDirectoryStatus !== "ok" || unavailableMailboxes.length > 0;

	return (
		<div className="mb-6 rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
			<div className="flex flex-col gap-3 border-b border-kumo-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="text-base font-semibold text-kumo-default">
							Attention Desk
						</h2>
						{hasAttention ? (
							<Badge variant="secondary">
								{hasUnknown ? "Partial: " : ""}{attention.attentionSignalCount} signals
							</Badge>
						) : hasUnknown ? (
							<span className="inline-flex items-center gap-1 text-xs font-medium text-kumo-subtle">
								<WarningCircleIcon size={14} />
								Partial check
							</span>
						) : (
							<span className="inline-flex items-center gap-1 text-xs font-medium text-kumo-subtle">
								<CheckCircleIcon size={14} />
								All clear
							</span>
						)}
					</div>
					<p className="mt-1 text-sm text-kumo-subtle">
						{attention.mailboxCount} mailboxes · {attention.triageVersion}
					</p>
				</div>
				{unavailableMailboxes.length > 0 && (
					<div className="flex items-center gap-2 text-xs font-medium text-kumo-subtle">
						<WarningCircleIcon size={16} />
						{unavailableMailboxes.length} check unavailable
					</div>
				)}
				{attention.mailboxDirectoryStatus !== "ok" && (
					<div className="flex items-center gap-2 text-xs font-medium text-kumo-subtle">
						<WarningCircleIcon size={16} />
						Mailbox list unavailable
					</div>
				)}
			</div>

			<div className="grid divide-y divide-kumo-line sm:grid-cols-5 sm:divide-x sm:divide-y-0">
				{attention.buckets.map((bucket) => (
					<AttentionBucketRow key={bucket.id} bucket={bucket} />
				))}
			</div>

			{attention.nextActions.length > 0 && (
				<div className="border-t border-kumo-line">
					<div className="px-5 py-3">
						<div className="text-xs font-semibold uppercase text-kumo-subtle">
							Next workflow
						</div>
					</div>
					<div className="divide-y divide-kumo-line">
						{attention.nextActions.map((action) => (
							<AttentionNextActionRow key={action.id} action={action} />
						))}
					</div>
				</div>
			)}

			{attention.topItems.length > 0 && (
				<div className="border-t border-kumo-line px-2 py-2">
					{attention.topItems.slice(0, 5).map((item) => (
						<AttentionItemRow key={item.id} item={item} />
					))}
				</div>
			)}
		</div>
	);
}

export default function HomeRoute() {
	const toastManager = useKumoToastManager();
	const { data: mailboxes = [], refetch: refetchMailboxes, isFetched: mailboxesFetched } = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();

	const { data: configData } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});

	const domains = configData?.domains ?? [];
	const emailAddresses = configData?.emailAddresses ?? [];

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [newName, setNewName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [mailboxToDelete, setMailboxToDelete] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Set default domain when config loads
	useEffect(() => {
		if (domains.length > 0 && !selectedDomain) {
			setSelectedDomain(domains[0]);
		}
	}, [domains, selectedDomain]);

	// Auto-create mailboxes from config (run once when both data sources are ready)
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched) return;
		const existingEmails = new Set(
			mailboxes.map((m) => m.email.toLowerCase()),
		);
		const toCreate = emailAddresses.filter(
			(addr) => !existingEmails.has(addr.toLowerCase()),
		);
		if (toCreate.length === 0) {
			autoCreateDone.current = true;
			return;
		}
		autoCreateDone.current = true;
		let cancelled = false;
		Promise.all(
			toCreate.map((addr) => {
				const localPart = addr.split("@")[0] || addr;
				return api.createMailbox(addr, localPart).catch(() => {});
			}),
		).then(() => { if (!cancelled) refetchMailboxes(); });
		return () => { cancelled = true; };
	}, [emailAddresses, mailboxes, refetchMailboxes]);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		if (!newPrefix || !selectedDomain) {
			setCreateError("Please fill in all fields");
			return;
		}
		const email = `${newPrefix}@${selectedDomain}`;
		const name = newName || newPrefix;
		setIsCreating(true);
		try {
			await createMailbox.mutateAsync({ email, name });
			toastManager.add({ title: "Mailbox created successfully!" });
			setIsCreateOpen(false);
			setNewPrefix("");
			setNewName("");
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to create mailbox";
			setCreateError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		setIsDeleting(true);
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toastManager.add({ title: "Mailbox deleted" });
			setIsDeleteOpen(false);
			setMailboxToDelete(null);
		} catch {
			toastManager.add({ title: "Failed to delete mailbox", variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

	const isConfigured = emailAddresses.length > 0;
	const accounts = isConfigured
		? emailAddresses.map((addr) => {
				const existingMailbox = mailboxes.find(
					(mailbox) => mailbox.email.toLowerCase() === addr.toLowerCase(),
				);
				return {
					id: addr,
					email: addr,
					name: addr.split("@")[0] || addr,
					unreadInboxCount: mailboxesFetched
						? existingMailbox
							? existingMailbox.unreadInboxCount ?? null
							: 0
						: undefined,
				};
			})
		: mailboxes;

	const isLoading = !configData;

	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
				<div className="mb-8">
					<div className="flex items-center justify-between">
						<h1 className="text-2xl font-bold text-kumo-default">Mailboxes</h1>
						{!isConfigured && (
							<Button
								variant="primary"
								icon={<PlusIcon size={16} />}
								onClick={() => setIsCreateOpen(true)}
							>
								New Mailbox
							</Button>
						)}
					</div>
					{domains.length > 0 && (
						<p className="text-sm text-kumo-subtle mt-1">
							{domains.join(", ")}
						</p>
					)}
				</div>

				<AttentionDesk />

				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader size="lg" />
					</div>
				) : accounts.length > 0 ? (
					<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
						{accounts.map((account, idx) => (
							<RouterLink
								key={account.id}
								to={`/mailbox/${account.id}`}
								className={`group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-kumo-tint ${
									idx > 0 ? "border-t border-kumo-line" : ""
								}`}
							>
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">
									{account.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium text-kumo-default truncate">
										{account.name}
									</div>
									<div className="truncate text-sm text-kumo-subtle">
										{account.email}
									</div>
									<div className="mt-1 flex sm:hidden">
										<MailboxPendingStatus count={account.unreadInboxCount} />
									</div>
								</div>
								<div className="hidden min-w-24 shrink-0 justify-end sm:flex">
									<MailboxPendingStatus count={account.unreadInboxCount} />
								</div>
								{!isConfigured && (
									<Button
										variant="ghost"
										size="sm"
										shape="square"
										icon={<TrashIcon size={16} />}
										aria-label={`Delete mailbox ${account.email}`}
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setMailboxToDelete({
												id: account.id,
												email: account.email,
											});
											setIsDeleteOpen(true);
										}}
									/>
								)}
							</RouterLink>
						))}
					</div>
				) : (
					<div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6">
						<div className="flex flex-col items-center text-center">
							<div className="mb-4">
								<EnvelopeIcon
									size={48}
									weight="thin"
									className="text-kumo-subtle"
								/>
							</div>
							<h3 className="text-base font-semibold text-kumo-default mb-1.5">
								No mailboxes yet
							</h3>
							<p className="text-sm text-kumo-subtle max-w-sm mb-5">
								{isConfigured
									? "Your email routing is configured but no mailboxes have been created yet. They will appear here automatically."
									: "Create a mailbox to start sending and receiving emails with your domain."}
							</p>
							{!isConfigured && (
								<Button
									variant="primary"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateOpen(true)}
								>
									Create Mailbox
								</Button>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Create Dialog */}
			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-5">
						Create New Mailbox
					</Dialog.Title>
					<form onSubmit={handleCreate} className="space-y-4">
						{createError && (
							<Text variant="error" size="sm">
								{createError}
							</Text>
						)}
						<div>
							<span className="text-sm font-medium text-kumo-default mb-1.5 block">
								Email Address
							</span>
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Input
										aria-label="Address prefix"
										placeholder="info"
										size="sm"
										value={newPrefix}
										onChange={(e) => setNewPrefix(e.target.value)}
										required
									/>
								</div>
								<span className="text-sm text-kumo-subtle">@</span>
								{domains.length > 1 ? (
									<div className="flex-1">
							<Select
								aria-label="Domain"
								value={selectedDomain}
								onValueChange={(value) => {
									if (value) setSelectedDomain(value);
								}}
							>
											{domains.map((d) => (
												<Select.Option key={d} value={d}>
													{d}
												</Select.Option>
											))}
										</Select>
									</div>
								) : (
									<span className="text-sm text-kumo-subtle">
										{selectedDomain || "no domain"}
									</span>
								)}
							</div>
						</div>
						<Input
							label="Display Name (optional)"
							placeholder="Info"
							size="sm"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
						/>
						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isCreating}
								disabled={!selectedDomain}
							>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete Dialog */}
			<Dialog.Root
				open={isDeleteOpen}
				onOpenChange={(open) => {
					setIsDeleteOpen(open);
					if (!open) setMailboxToDelete(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Delete Mailbox
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Are you sure you want to delete{" "}
						<strong className="text-kumo-default">
							{mailboxToDelete?.email}
						</strong>
						? This action cannot be undone.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									Cancel
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							size="sm"
							loading={isDeleting}
							onClick={handleDelete}
						>
							Delete
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
