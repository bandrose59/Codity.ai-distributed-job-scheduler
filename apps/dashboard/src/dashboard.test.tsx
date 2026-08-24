import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobCreateForm } from "./components/JobCreateForm";

import { App } from "./App";

describe("dashboard application", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("requires authentication before showing operations", () => {
    localStorage.removeItem("scheduler-token");
    render(<App />);

    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders the dashboard shell and key sections", () => {
    localStorage.setItem("scheduler-token", "test-token");
    render(<App />);

    expect(screen.getByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("shows job-specific fields based on selected type", async () => {
    localStorage.setItem("scheduler-token", "test-token");
    const user = userEvent.setup();
    render(<JobCreateForm onSubmit={() => undefined} queues={[]} />);

    await user.selectOptions(screen.getByLabelText(/job type/i), "CRON");

    expect(screen.getByLabelText(/cron expression/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
  });

  it("stores an uploaded script in the submitted job payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JobCreateForm onSubmit={onSubmit} queues={[{
      id: "00000000-0000-0000-0000-000000000001",
      projectId: "00000000-0000-0000-0000-000000000002",
      name: "email",
      priority: 10,
      concurrencyLimit: 5,
      status: "ACTIVE",
      retryPolicy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }]} />);

    await user.click(screen.getByRole("button", { name: /upload script/i }));
    await user.upload(screen.getByLabelText(/upload script/i), new File(["console.log('hello')"], "hello.js", { type: "text/javascript" }));
    await user.click(screen.getByRole("button", { name: /create job/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      payload: { script: { name: "hello.js", content: "console.log('hello')" } }
    }));
  });
});
