import { useEffect, useState } from "react";
import { getMe } from "@/lib/api";
export function LoginGate() {
  const [state, setState] = useState<"checking" | "denied" | "error">(
    "checking",
  );
  useEffect(() => {
    let current = true;
    getMe()
      .then(() => {
        if (current) window.location.href = "/overview";
      })
      .catch((error) => {
        if (!current) return;
        const returned =
          new URL(window.location.href).searchParams.get("returned") === "1";
        if (returned) setState("denied");
        else if (error.message !== "unauthenticated") setState("error");
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <div className="login-page">
      <section className="login-story">
        <a className="brand" href="/">
          <span className="brand-mark">cc</span>
          <span>
            ccusage<span className="brand-sub">personal workspace</span>
          </span>
        </a>
        <h1>
          Your AI usage.
          <br />A clearer picture.
        </h1>
        <p>
          Bring your tools, projects, and devices together in one private
          workspace. Understand where your tokens go and what your work costs.
        </p>
      </section>
      <main className="login-content">
        <div className="login-card">
          <p className="eyebrow">WELCOME TO YOUR WORKSPACE</p>
          {state === "denied" ? (
            <>
              <h2>Not authorized</h2>
              <p>
                Your account isn't permitted to access this app. Contact the
                owner if you think this is a mistake.
              </p>
            </>
          ) : state === "error" ? (
            <>
              <h2>Unable to connect</h2>
              <p>We couldn't check your account. Please try again.</p>
              <button
                className="button button-primary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <h2>Let’s get you signed in.</h2>
              <p role="status">
                <span className="loading-dot" />
                Redirecting to sign in…
              </p>
              <p>Secure sign-in. Personal insights. No shared usage.</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
