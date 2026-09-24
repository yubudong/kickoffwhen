"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { AuthorizedChild } from "@/modules/devices/service";

const subscribeToHydration = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ProfileSelector({
  availableChildren,
}: {
  availableChildren: AuthorizedChild[];
}) {
  const automaticSelectionStarted = useRef(false);
  const onlyChild = availableChildren.length === 1 ? availableChildren[0] : null;
  const [selected, setSelected] = useState<AuthorizedChild | null>(
    onlyChild?.requiresPin ? onlyChild : null,
  );
  const interactive = useSyncExternalStore(
    subscribeToHydration,
    clientSnapshot,
    serverSnapshot,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const enter = useCallback(
    async (child: AuthorizedChild, childPin?: string) => {
      setPending(true);
      setError("");
      const response = await fetch("/api/child/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ childId: child.id, childPin }),
      });
      setPending(false);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (payload?.error === "CHILD_PIN_INVALID") {
          setError("儿童口令不正确。");
          return;
        }
        setError("暂时无法进入，请重新配对或稍后再试。");
        return;
      }
      window.location.replace("/child");
    },
    [],
  );

  useEffect(() => {
    window.sessionStorage.removeItem("family-learning:child-page-state");
  }, []);

  useEffect(() => {
    if (
      availableChildren.length === 1 &&
      !availableChildren[0].requiresPin &&
      !automaticSelectionStarted.current
    ) {
      automaticSelectionStarted.current = true;
      void enter(availableChildren[0]);
    }
  }, [availableChildren, enter]);

  function choose(child: AuthorizedChild) {
    if (child.requiresPin) {
      setSelected(child);
      setError("");
      return;
    }
    void enter(child);
  }

  function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const childPin = String(new FormData(event.currentTarget).get("childPin"));
    void enter(selected, childPin);
  }

  return (
    <main className="page-shell">
      <section className="hero-card child-select-card">
        <p className="eyebrow">家庭学习</p>
        <h1>
          {onlyChild && !onlyChild.requiresPin
            ? "正在进入…"
            : onlyChild
              ? "请输入儿童口令"
              : "今天是谁来学习？"}
        </h1>
        {availableChildren.length > 1 || onlyChild?.requiresPin ? (
          <div className="child-choice-grid">
            {availableChildren.map((child) => (
              <button
                disabled={pending || !interactive}
                key={child.id}
                onClick={() => choose(child)}
                type="button"
              >
                <span aria-hidden="true" className="avatar-badge">
                  {child.avatarKey === "rocket-blue" ? "🚀" : "🌟"}
                </span>
                <strong>{child.nickname}</strong>
                {child.requiresPin ? <small>需要口令</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {selected ? (
          <form className="auth-form pin-entry" onSubmit={submitPin}>
            <label>
              6 位儿童口令
              <input
                inputMode="numeric"
                maxLength={6}
                name="childPin"
                pattern="\d{6}"
                required
                type="password"
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <button disabled={pending || !interactive} type="submit">
              {pending ? "验证中…" : `进入${selected.nickname}`}
            </button>
          </form>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
