import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors.js";
import type { UserProfile } from "../api/types.js";
import { queryKeys } from "../query/keys.js";
import { useUpdateGlobalNotifications, useUpdateLeagueNotifications } from "./use-notification-preferences.js";

vi.mock("../api/endpoints.js", () => ({ updateGlobalNotifications: vi.fn(), updateLeagueNotifications: vi.fn() }));

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    email: "a@example.com",
    displayName: "Test",
    timezone: "UTC",
    avatarUrl: null,
    emailVerifiedAt: "2026-08-13T00:00:00.000Z",
    pendingEmail: null,
    deletionRequestedAt: null,
    scheduledDeletionAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    notificationsEnabled: true,
    ...overrides,
  };
}

function wrapperWithClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateGlobalNotifications", () => {
  it("optimistically flips the cached profile immediately", async () => {
    const { updateGlobalNotifications } = await import("../api/endpoints.js");
    vi.mocked(updateGlobalNotifications).mockImplementation(() => new Promise(() => {})); // never resolves for this assertion

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(queryKeys.me(), profile({ notificationsEnabled: true }));

    const { result } = renderHook(() => useUpdateGlobalNotifications(), { wrapper: wrapperWithClient(client) });
    result.current.mutate(false);

    await waitFor(() => expect(client.getQueryData<UserProfile>(queryKeys.me())?.notificationsEnabled).toBe(false));
  });

  it("reverts to the exact prior snapshot on rejection", async () => {
    const { updateGlobalNotifications } = await import("../api/endpoints.js");
    vi.mocked(updateGlobalNotifications).mockRejectedValue(new ApiError({ code: "INTERNAL_ERROR", message: "nope" }, 500));

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(queryKeys.me(), profile({ notificationsEnabled: true, displayName: "Original" }));

    const { result } = renderHook(() => useUpdateGlobalNotifications(), { wrapper: wrapperWithClient(client) });
    result.current.mutate(false);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<UserProfile>(queryKeys.me())).toEqual(profile({ notificationsEnabled: true, displayName: "Original" }));
  });

  it("reconciles with the server's own confirmed value on success", async () => {
    const { updateGlobalNotifications } = await import("../api/endpoints.js");
    vi.mocked(updateGlobalNotifications).mockResolvedValue({ notificationsEnabled: false });

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(queryKeys.me(), profile({ notificationsEnabled: true }));

    const { result } = renderHook(() => useUpdateGlobalNotifications(), { wrapper: wrapperWithClient(client) });
    result.current.mutate(false);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData<UserProfile>(queryKeys.me())?.notificationsEnabled).toBe(false);
  });
});

describe("useUpdateLeagueNotifications", () => {
  it("calls the endpoint with the given league/member/enabled", async () => {
    const { updateLeagueNotifications } = await import("../api/endpoints.js");
    vi.mocked(updateLeagueNotifications).mockResolvedValue({ notificationsEnabled: false });

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateLeagueNotifications(), { wrapper: wrapperWithClient(client) });

    result.current.mutate({ leagueId: "league-1", memberId: "member-1", enabled: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateLeagueNotifications).toHaveBeenCalledWith("league-1", "member-1", false);
  });
});
