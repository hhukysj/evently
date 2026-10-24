import { useEffect, useState, type FormEvent } from "react";
import {
  currentUser as fetchCurrentUser,
  developmentInbox,
  postAuth,
  type CurrentUser,
  type DevelopmentEmailMessage,
} from "./auth-api.js";

type AuthPage =
  | "home"
  | "register"
  | "login"
  | "verify-email"
  | "forgot-password"
  | "reset-password";

function currentPage(): AuthPage {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/register":
      return "register";
    case "/login":
      return "login";
    case "/verify-email":
      return "verify-email";
    case "/forgot-password":
      return "forgot-password";
    case "/reset-password":
      return "reset-password";
    default:
      return "home";
  }
}

function tokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export default function App() {
  const page = currentPage();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [inboxRevision, setInboxRevision] = useState(0);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [authScreenRevision, setAuthScreenRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchCurrentUser()
      .then((current) => {
        if (active) {
          setUser(current);
        }
      })
      .catch(() => {
        if (active) {
          setSessionError("Unable to check your sign-in status.");
        }
      })
      .finally(() => {
        if (active) {
          setUserLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    setLogoutLoading(true);
    setSessionError("");
    try {
      await postAuth("/api/v1/auth/logout", {});
      setUser(null);
      setAuthScreenRevision((revision) => revision + 1);
    } catch (error) {
      setSessionError(errorMessage(error));
    } finally {
      setLogoutLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Evently home">
          Evently
        </a>
        <nav aria-label="Account navigation">
          {user ? (
            <>
              <span className="signed-in">{user.email}</span>
              <button
                className="button button-secondary button-small"
                disabled={logoutLoading}
                onClick={() => void logout()}
                type="button"
              >
                {logoutLoading ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <a href="/login">Sign in</a>
              <a className="nav-cta" href="/register">
                Create account
              </a>
            </>
          )}
        </nav>
      </header>

      <section className="auth-layout" aria-labelledby="page-title">
        <div className="auth-intro">
          <p className="eyebrow">Event services marketplace</p>
          <h1 id="page-title">
            {page === "home" ? "Plan something worth remembering." : "Evently"}
          </h1>
          <p className="intro">
            A thoughtful place to plan events and connect with the people who
            bring them together.
          </p>
          {page === "home" && user && (
            <p className="status" role="status">
              Signed in as {user.email}
            </p>
          )}
          {page === "home" && !userLoading && !user && (
            <div className="home-actions">
              <a className="button" href="/register">
                Create your account
              </a>
              <a className="text-link" href="/login">
                Already have an account? Sign in
              </a>
            </div>
          )}
          {userLoading && (
            <p className="muted" role="status">
              Checking your session…
            </p>
          )}
          {sessionError && (
            <p className="form-error" role="alert">
              {sessionError}
            </p>
          )}
        </div>

        {page !== "home" && (
          <AuthScreen
            key={`${page}-${authScreenRevision}`}
            onAuthenticated={setUser}
            onEmailAction={() => setInboxRevision((revision) => revision + 1)}
            page={page}
            token={tokenFromUrl()}
          />
        )}
      </section>

      {import.meta.env.DEV && <DevelopmentInbox revision={inboxRevision} />}
    </main>
  );
}

function AuthScreen({
  page,
  token,
  onAuthenticated,
  onEmailAction,
}: {
  page: Exclude<AuthPage, "home">;
  token: string;
  onAuthenticated: (user: CurrentUser) => void;
  onEmailAction: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: (form: FormData) => Promise<void>,
  ) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action(new FormData(event.currentTarget));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  if (page === "register") {
    return (
      <div className="auth-card">
        <h2>Create your account</h2>
        <p className="muted">Start with your email and a secure password.</p>
        <form
          aria-busy={loading}
          onSubmit={(event) =>
            void submit(event, async (form) => {
              const result = await postAuth<{ message: string }>(
                "/api/v1/auth/register",
                {
                  email: value(form, "email"),
                  password: value(form, "password"),
                },
              );
              setMessage(result.message);
              onEmailAction();
            })
          }
        >
          <EmailField />
          <PasswordField
            autoComplete="new-password"
            id="password"
            minLength={12}
            label="Password"
          />
          <FormFeedback error={error} message={message} />
          <button className="button" disabled={loading} type="submit">
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="auth-footer">
          Already registered? <a href="/login">Sign in</a>
        </p>
      </div>
    );
  }

  if (page === "login") {
    return (
      <div className="auth-card">
        <h2>Sign in</h2>
        <p className="muted">Use the email address on your account.</p>
        <form
          aria-busy={loading}
          onSubmit={(event) =>
            void submit(event, async (form) => {
              const result = await postAuth<{
                user: CurrentUser;
              }>("/api/v1/auth/login", {
                email: value(form, "email"),
                password: value(form, "password"),
              });
              onAuthenticated(result.user);
              setMessage(`You are signed in as ${result.user.email}.`);
            })
          }
        >
          <EmailField />
          <PasswordField
            autoComplete="current-password"
            id="password"
            label="Password"
            minLength={1}
          />
          <FormFeedback error={error} message={message} />
          <button className="button" disabled={loading} type="submit">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="auth-footer">
          <a href="/forgot-password">Forgot your password?</a>
        </p>
        <p className="auth-footer">
          Need an account? <a href="/register">Create one</a>
        </p>
      </div>
    );
  }

  if (page === "verify-email") {
    return token ? (
      <div className="auth-card">
        <h2>Verify your email</h2>
        <p className="muted">
          Submit the link from your account message to verify your address.
        </p>
        <form
          aria-busy={loading}
          onSubmit={(event) =>
            void submit(event, async () => {
              const result = await postAuth<{ message: string }>(
                "/api/v1/auth/verify-email",
                { token },
              );
              setMessage(result.message);
            })
          }
        >
          <FormFeedback error={error} message={message} />
          <button className="button" disabled={loading} type="submit">
            {loading ? "Checking link…" : "Verify email"}
          </button>
        </form>
        <p className="auth-footer">
          <a href="/login">Continue to sign in</a>
        </p>
      </div>
    ) : (
      <div className="auth-card">
        <h2>Request a verification link</h2>
        <p className="muted">
          Enter your account email. The response will not reveal account status.
        </p>
        <form
          aria-busy={loading}
          onSubmit={(event) =>
            void submit(event, async (form) => {
              const result = await postAuth<{ message: string }>(
                "/api/v1/auth/verification-request",
                { email: value(form, "email") },
              );
              setMessage(result.message);
              onEmailAction();
            })
          }
        >
          <EmailField />
          <FormFeedback error={error} message={message} />
          <button className="button" disabled={loading} type="submit">
            {loading ? "Requesting link…" : "Request verification"}
          </button>
        </form>
      </div>
    );
  }

  if (page === "forgot-password") {
    return (
      <div className="auth-card">
        <h2>Reset your password</h2>
        <p className="muted">
          The response does not reveal whether an account exists. If eligible,
          instructions will be available through the configured account channel.
        </p>
        <form
          aria-busy={loading}
          onSubmit={(event) =>
            void submit(event, async (form) => {
              const result = await postAuth<{ message: string }>(
                "/api/v1/auth/forgot-password",
                { email: value(form, "email") },
              );
              setMessage(result.message);
              onEmailAction();
            })
          }
        >
          <EmailField />
          <FormFeedback error={error} message={message} />
          <button className="button" disabled={loading} type="submit">
            {loading ? "Requesting reset…" : "Request password reset"}
          </button>
        </form>
        <p className="auth-footer">
          <a href="/login">Return to sign in</a>
        </p>
      </div>
    );
  }

  return token ? (
    <div className="auth-card">
      <h2>Choose a new password</h2>
      <p className="muted">Use at least 12 characters for your new password.</p>
      <form
        aria-busy={loading}
        onSubmit={(event) =>
          void submit(event, async (form) => {
            const result = await postAuth<{ message: string }>(
              "/api/v1/auth/reset-password",
              { token, password: value(form, "password") },
            );
            setMessage(result.message);
          })
        }
      >
        <PasswordField
          autoComplete="new-password"
          id="password"
          minLength={12}
          label="New password"
        />
        <FormFeedback error={error} message={message} />
        <button className="button" disabled={loading} type="submit">
          {loading ? "Updating password…" : "Update password"}
        </button>
      </form>
      <p className="auth-footer">
        <a href="/login">Return to sign in</a>
      </p>
    </div>
  ) : (
    <div className="auth-card">
      <h2>Password link required</h2>
      <p className="muted">Open a valid reset link or request a new one.</p>
      <a className="button" href="/forgot-password">
        Request a reset link
      </a>
    </div>
  );
}

function EmailField() {
  return (
    <>
      <label htmlFor="email">Email address</label>
      <input
        autoComplete="email"
        id="email"
        maxLength={254}
        name="email"
        required
        type="email"
      />
    </>
  );
}

function PasswordField({
  autoComplete,
  id,
  label,
  minLength,
}: {
  autoComplete: string;
  id: string;
  label: string;
  minLength: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          autoComplete={autoComplete}
          id={id}
          maxLength={128}
          minLength={minLength}
          name="password"
          required
          type={visible ? "text" : "password"}
        />
        <button
          aria-pressed={visible}
          className="password-toggle"
          onClick={() => setVisible((shown) => !shown)}
          type="button"
        >
          {visible ? "Hide password" : "Show password"}
        </button>
      </div>
      {minLength > 1 && (
        <p className="field-hint">Use at least {minLength} characters.</p>
      )}
    </>
  );
}

function FormFeedback({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
    </>
  );
}

function DevelopmentInbox({ revision }: { revision: number }) {
  const [messages, setMessages] = useState<DevelopmentEmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setMessages(await developmentInbox());
    } catch {
      setError(
        "Local inbox unavailable. Start the API in development and refresh.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void developmentInbox()
      .then((currentMessages) => {
        if (active) {
          setMessages(currentMessages);
          setError("");
        }
      })
      .catch(() => {
        if (active) {
          setError(
            "Local inbox unavailable. Start the API in development and refresh.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);

  return (
    <section className="dev-inbox" aria-labelledby="dev-inbox-title">
      <div className="inbox-heading">
        <div>
          <p className="eyebrow">Development only</p>
          <h2 id="dev-inbox-title">Local account inbox</h2>
        </div>
        <button
          className="button button-secondary button-small"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="muted">
        These messages are kept in memory for local testing. They are not sent
        to an email address.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && !loading && messages.length === 0 && (
        <p className="empty-inbox">No local account messages yet.</p>
      )}
      {messages.length > 0 && (
        <ul className="inbox-list">
          {messages.map((message) => {
            const verification = message.type === "email_verification";
            const destination = verification
              ? "/verify-email"
              : "/reset-password";
            return (
              <li key={message.id}>
                <div>
                  <strong>
                    {verification ? "Email verification" : "Password reset"}
                  </strong>
                  <span>{message.email}</span>
                </div>
                <a
                  href={`${destination}?token=${encodeURIComponent(message.token)}`}
                >
                  Open local link
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function value(form: FormData, name: string): string {
  const input = form.get(name);
  return typeof input === "string" ? input : "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error instanceof TypeError) {
      return "Unable to reach Evently. Check that the API is running and try again.";
    }
    return error.message;
  }
  return "The request could not be completed. Please try again.";
}
