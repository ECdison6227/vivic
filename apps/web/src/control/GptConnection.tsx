import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelGptLogin, completeGptLogin, connectGpt, disconnectGpt, getGptLoginStatus, startGptLogin, type LoginStatus } from "@/ai/providers";

export function GptConnection({ disabled, connected, onChange }: { disabled: boolean; connected: boolean; onChange: () => Promise<unknown> }) {
  const [login, setLogin] = useState<LoginStatus>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callback, setCallback] = useState("");
  const pending = login.phase === "waiting" || login.phase === "verifying";
  useEffect(() => {
    if (!pending) return;
    let mounted = true;
    const refresh = async () => {
      try { const result = await getGptLoginStatus(); if (!mounted) return; setLogin(result.login); if (["connected", "error"].includes(result.login.phase)) void onChange(); }
      catch { if (mounted) { setError("登录状态暂不可达，可重试或取消。"); setLogin({ phase: "error" }); } }
    };
    const timer = setInterval(() => void refresh(), 1000); void refresh();
    return () => { mounted = false; clearInterval(timer); };
  }, [pending, onChange]);
  const run = async (work: () => Promise<{ ok: boolean; error?: string; lastError?: string; login?: LoginStatus }>) => {
    setBusy(true); setError(null);
    try { const result = await work(); if (result.login) setLogin(result.login); if (!result.ok) setError(result.error ?? result.lastError ?? "GPT 连接失败。"); }
    catch (error) { setError(error instanceof Error ? error.message : "GPT 连接失败。"); }
    finally { setBusy(false); await onChange(); }
  };
  const authUrl = (() => { try { const url = new URL(login.authUrl ?? ""); return url.origin === "https://auth.openai.com" ? url.href : undefined; } catch { return undefined; } })();
  return <div className="mt-3 space-y-3" data-vivic-gpt-connection>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled || busy || pending} onClick={() => void run(() => connectGpt("pi"))} data-vivic-gpt-use-pi>使用本机 Pi 登录</Button>
      <Button variant="outline" disabled={disabled || busy || pending} onClick={() => void run(() => connectGpt("vivic"))}>恢复本机 GPT 登录</Button>
      <Button disabled={disabled || busy || pending} onClick={() => void run(startGptLogin)} data-vivic-gpt-login>Continue with ChatGPT</Button>
      <Button variant="secondary" disabled={disabled || busy || !connected} onClick={() => void run(disconnectGpt)} data-vivic-gpt-disconnect>断开 GPT</Button>
    </div>
    {pending && <div className="space-y-2 text-xs" role="status">
      <p>{login.phase === "verifying" ? "正在验证 GPT 推理权限…" : "等待你在浏览器完成授权…"}</p>
      {authUrl && <a href={authUrl} target="_blank" rel="noreferrer" className="inline-block underline underline-offset-2" data-vivic-gpt-auth-link>继续 ChatGPT 授权</a>}
      {login.needsInput && <div className="flex gap-2"><Input type="password" value={callback} autoComplete="off" aria-label="GPT 完整回调地址" placeholder="未自动返回时，粘贴完整回调地址" onChange={event => setCallback(event.target.value)} />
        <Button variant="outline" disabled={disabled || !callback.trim() || busy} onClick={() => { const value = callback; setCallback(""); void run(() => completeGptLogin(value)); }}>完成授权</Button></div>}
      <Button variant="ghost" disabled={disabled || busy} onClick={() => void run(async () => { const result = await cancelGptLogin(); setLogin({ phase: "idle" }); return result; })}>取消登录</Button>
    </div>}
    <p className="text-xs text-neutral-500">GPT 复用 Pi 的登录能力；推理与搜索使用你的 ChatGPT 套餐，语音另行选择。<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer" className="ml-1 underline">管理用量与授权</a></p>
    {(error || login.error) && <p className="text-xs text-red-700" role="status">{error ?? login.error}</p>}
  </div>;
}
