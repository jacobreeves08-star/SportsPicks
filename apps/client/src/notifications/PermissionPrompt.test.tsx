import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { PermissionPrompt } from "./PermissionPrompt.js";

const mockUseFirstCompletionPrompt = vi.hoisted(() => vi.fn<() => boolean>());
vi.mock("./use-first-completion-prompt.js", () => ({ useFirstCompletionPrompt: mockUseFirstCompletionPrompt }));

const mockUseNotificationPermission = vi.hoisted(() =>
  vi.fn<() => { state: string; request: () => Promise<string> }>(),
);
vi.mock("./use-notification-permission.js", () => ({ useNotificationPermission: mockUseNotificationPermission }));

describe("PermissionPrompt", () => {
  it("renders nothing when the completion trigger hasn't fired", () => {
    mockUseFirstCompletionPrompt.mockReturnValue(false);
    mockUseNotificationPermission.mockReturnValue({ state: "default", request: vi.fn() });

    const { container } = render(<PermissionPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders when the trigger fired and permission is still 'default'", () => {
    mockUseFirstCompletionPrompt.mockReturnValue(true);
    mockUseNotificationPermission.mockReturnValue({ state: "default", request: vi.fn() });

    render(<PermissionPrompt />);
    expect(screen.getByText("Get a browser notification too?")).toBeInTheDocument();
  });

  it("clearly labels this as separate from email delivery — never implies push exists", () => {
    mockUseFirstCompletionPrompt.mockReturnValue(true);
    mockUseNotificationPermission.mockReturnValue({ state: "default", request: vi.fn() });

    render(<PermissionPrompt />);
    expect(screen.getByText(/you.ll still get email reminders either way/i)).toBeInTheDocument();
  });

  it("does not render once permission is already granted", () => {
    mockUseFirstCompletionPrompt.mockReturnValue(true);
    mockUseNotificationPermission.mockReturnValue({ state: "granted", request: vi.fn() });

    const { container } = render(<PermissionPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render once permission is denied", () => {
    mockUseFirstCompletionPrompt.mockReturnValue(true);
    mockUseNotificationPermission.mockReturnValue({ state: "denied", request: vi.fn() });

    const { container } = render(<PermissionPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Enable calls request()", () => {
    const request = vi.fn().mockResolvedValue("granted");
    mockUseFirstCompletionPrompt.mockReturnValue(true);
    mockUseNotificationPermission.mockReturnValue({ state: "default", request });

    render(<PermissionPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("Not now dismisses the prompt without calling request()", () => {
    const request = vi.fn();
    mockUseFirstCompletionPrompt.mockReturnValue(true);
    mockUseNotificationPermission.mockReturnValue({ state: "default", request });

    render(<PermissionPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByText("Get a browser notification too?")).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    mockUseFirstCompletionPrompt.mockReturnValue(true);
    mockUseNotificationPermission.mockReturnValue({ state: "default", request: vi.fn() });

    const { container } = render(<PermissionPrompt />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
