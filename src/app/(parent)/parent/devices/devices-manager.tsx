"use client";

import { type FormEvent, useState } from "react";

import type { Child } from "@/modules/families/service";

type DeviceView = {
  id: string;
  label: string;
  lastActiveAt: string;
  revokedAt: string | null;
  children: Array<{ id: string; nickname: string }>;
};

export function DevicesManager({
  availableChildren,
  initialDevices,
}: {
  availableChildren: Child[];
  initialDevices: DeviceView[];
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function createPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const childIds = new FormData(event.currentTarget)
      .getAll("childIds")
      .map(String);
    const response = await fetch("/api/parent/devices/pairing-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ childIds }),
    });
    setPending(false);
    if (!response.ok) {
      setError("请选择至少一个可用的孩子后重试。");
      return;
    }
    setPairing((await response.json()) as { code: string; expiresAt: string });
  }

  async function revoke(device: DeviceView) {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/parent/devices/${encodeURIComponent(device.id)}/revoke`,
      { method: "POST" },
    );
    setPending(false);
    if (!response.ok) {
      setError("暂时未能撤销设备，请重试。");
      return;
    }
    setDevices((current) =>
      current.map((item) =>
        item.id === device.id
          ? { ...item, revokedAt: new Date().toISOString() }
          : item,
      ),
    );
  }

  async function updateAccess(
    event: FormEvent<HTMLFormElement>,
    device: DeviceView,
  ) {
    event.preventDefault();
    setPending(true);
    setError("");
    const childIds = new FormData(event.currentTarget)
      .getAll("childIds")
      .map(String);
    const response = await fetch(
      `/api/parent/devices/${encodeURIComponent(device.id)}/children`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ childIds }),
      },
    );
    setPending(false);
    if (!response.ok) {
      setError("设备必须保留至少一个可用孩子，请检查后重试。");
      return;
    }
    const selected = new Set(childIds);
    setDevices((current) =>
      current.map((item) =>
        item.id === device.id
          ? {
              ...item,
              children: availableChildren
                .filter((child) => selected.has(child.id))
                .map((child) => ({ id: child.id, nickname: child.nickname })),
            }
          : item,
      ),
    );
  }

  return (
    <main className="page-shell children-shell">
      <section className="hero-card devices-card">
        <p className="eyebrow">家长中心</p>
        <h1>家庭设备</h1>
        <p>选择这台设备可以使用的孩子档案。配对码十分钟内有效，且只能使用一次。</p>
        <form className="auth-form" onSubmit={createPairing}>
          <fieldset>
            <legend>授权孩子</legend>
            {availableChildren.map((child) => (
              <label key={child.id}>
                <input name="childIds" type="checkbox" value={child.id} />
                授权 {child.nickname}
              </label>
            ))}
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <button disabled={pending} type="submit">
            {pending ? "生成中…" : "生成配对码"}
          </button>
        </form>
        {pairing ? (
          <div className="pairing-secret" role="status">
            <span>在孩子设备输入</span>
            <strong data-pairing-code>{pairing.code}</strong>
            <small>到期时间：{new Date(pairing.expiresAt).toLocaleTimeString("zh-CN")}</small>
          </div>
        ) : null}

        <h2>已配对设备</h2>
        <div className="device-list">
          {devices.length === 0 ? <p>还没有配对设备。</p> : null}
          {devices.map((device) => (
            <article className="device-row" key={device.id}>
              <div>
                <strong>{device.label}</strong>
                <p data-device-children>
                  {device.children.map((child) => child.nickname).join("、")}
                </p>
                <small>
                  最近活跃：{new Date(device.lastActiveAt).toLocaleString("zh-CN")}
                </small>
                {!device.revokedAt ? (
                  <form onSubmit={(event) => updateAccess(event, device)}>
                    <fieldset>
                      <legend>可使用的孩子</legend>
                      {availableChildren.map((child) => (
                        <label key={child.id}>
                          <input
                            defaultChecked={device.children.some(
                              (allowed) => allowed.id === child.id,
                            )}
                            name="childIds"
                            type="checkbox"
                            value={child.id}
                          />
                          {`允许 ${device.label} 使用 ${child.nickname}`}
                        </label>
                      ))}
                    </fieldset>
                    <button disabled={pending} type="submit">
                      {`保存 ${device.label} 的孩子权限`}
                    </button>
                  </form>
                ) : null}
              </div>
              {device.revokedAt ? (
                <span className="revoked-label">已撤销</span>
              ) : (
                <button
                  aria-label={`撤销 ${device.label}`}
                  disabled={pending}
                  onClick={() => revoke(device)}
                  type="button"
                >
                  撤销
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
