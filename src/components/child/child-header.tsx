"use client";

export function ChildHeader({
  avatarKey,
  nickname,
}: {
  avatarKey: string;
  nickname: string;
}) {
  return (
    <header className="child-header">
      <div>
        <span aria-hidden="true" className="avatar-badge">
          {avatarKey === "rocket-blue" ? "🚀" : "🌟"}
        </span>
        <h2>你好，{nickname}</h2>
      </div>
      <button
        className="primary-link child-switch-link"
        onClick={() => window.location.replace("/child/switch")}
        type="button"
      >
        切换孩子
      </button>
    </header>
  );
}
