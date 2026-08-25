import { useState, useEffect, useRef } from "react";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import { Loader2 } from "lucide-react";

const COLORS = ["#ff926b", "#87ddfe", "#acaaff", "#1bffc2", "#f9a5fe"];
const BG = "#15182e";
const SHAPES = ["c", "s", "t"] as const;

interface Particle {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  color: string;
  shape: (typeof SHAPES)[number];
  opacity: number;
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  p: Particle
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = p.color;
  ctx.shadowColor = p.color;
  ctx.shadowBlur = p.size * 1.5;
  ctx.translate(p.x, p.y);

  if (p.shape === "c") {
    ctx.beginPath();
    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.shape === "s") {
    const h = p.size / 2;
    ctx.beginPath();
    ctx.rect(-h, -h, p.size, p.size);
    ctx.fill();
  } else {
    const h = p.size / 2;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(h, h);
    ctx.lineTo(-h, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function useParticleCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let particles: Particle[] = [];

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }

    function spawnParticles() {
      if (!canvas) return;
      particles = Array.from({ length: 10 }, () => ({
        x: rand(0, canvas!.width),
        y: rand(0, canvas!.height),
        size: rand(2, 40),
        vx: rand(0, 0.8) * (Math.random() < 0.5 ? 1 : -1),
        vy: rand(0, 0.2) * (Math.random() < 0.5 ? 1 : -1),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
        opacity: rand(0.55, 1),
      }));
    }

    function tick() {
      if (!canvas || !ctx) return;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -p.size) p.x = canvas.width + p.size;
        if (p.x > canvas.width + p.size) p.x = -p.size;
        if (p.y < -p.size) p.y = canvas.height + p.size;
        if (p.y > canvas.height + p.size) p.y = -p.size;
        drawShape(ctx, p);
      }
      raf = requestAnimationFrame(tick);
    }

    resize();
    spawnParticles();
    tick();

    const ro = new ResizeObserver(() => {
      resize();
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [canvasRef]);
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useParticleCanvas(canvasRef);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Sign-in failed. Please try again.";
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative flex flex-col px-6 overflow-hidden justify-center items-center">
      {/* Particle canvas background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 0, display: "block" }}
      />
      {/* Logo above card */}
      <div className="relative z-10 flex flex-col items-center gap-2 mb-7">
        <div
          className="w-14 h-14 rounded-2xl overflow-hidden"
          style={{
            boxShadow:
              "0 0 28px rgba(139,92,246,0.6), 0 0 70px rgba(109,40,217,0.3), 0 0 0 1px rgba(167,139,250,0.25)",
          }}
        >
          <img src="/logo.jpg" alt="TradeEdge" className="w-full h-full object-cover" />
        </div>
        <p
          className="text-[10px] uppercase tracking-[0.25em] mt-1 font-bold"
          style={{ color: "rgba(200,180,255,0.55)" }}
        >Select2notion</p>
      </div>
      {/* Glass card */}
      <div
        className="relative z-10 w-full max-w-sm rounded-3xl p-8 flex flex-col items-center gap-5 bg-[#1c083a00]"
        style={{
          background: "rgba(28,8,58,0.58)",
          backdropFilter: "blur(32px) saturate(200%)",
          WebkitBackdropFilter: "blur(32px) saturate(200%)",
          border: "1px solid rgba(167,139,250,0.2)",
          boxShadow: [
            "0 0 0 1px rgba(255,255,255,0.06) inset",
            "0 1px 0 rgba(255,255,255,0.12) inset",
            "0 40px 100px rgba(0,0,0,0.65)",
            "0 0 50px rgba(109,40,217,0.18)",
          ].join(", "),
        }}
      >
        {/* Heading */}
        <div className="text-center w-full">
          <h1
            className="text-2xl font-black tracking-tight mb-1.5"
            style={{ color: "#ede9fe" }}
          >
            Welcome back
          </h1>
          <p className="text-sm font-semibold text-[#c4b5fd]" style={{ color: "rgba(196,181,253,0.5)" }}>
            Sign in to access your trading journal.
          </p>
        </div>

        {/* Thin divider */}
        <div
          className="w-full h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(167,139,250,0.25), transparent)",
          }}
        />

        {/* Error */}
        {error && (
          <div
            className="w-full px-4 py-3 rounded-xl text-sm font-medium"
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.22)",
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        )}

        {/* Google sign-in */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl font-bold text-sm transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed bg-[#08070761] opacity-[1]"
          style={{
            background:
              "linear-gradient(135deg, rgba(139,92,246,0.8) 0%, rgba(109,40,217,0.9) 100%)",
            color: "#ede9fe",
            border: "1px solid rgba(167,139,250,0.35)",
            boxShadow: [
              "0 0 0 1px rgba(255,255,255,0.09) inset",
              "0 1px 0 rgba(255,255,255,0.16) inset",
              "0 0 22px rgba(139,92,246,0.5)",
              "0 0 60px rgba(109,40,217,0.18)",
            ].join(", "),
          }}
          onMouseEnter={(e) => {
            if (loading) return;
            const el = e.currentTarget;
            el.style.transform = "translateY(-1px)";
            el.style.boxShadow = [
              "0 0 0 1px rgba(255,255,255,0.11) inset",
              "0 1px 0 rgba(255,255,255,0.2) inset",
              "0 0 32px rgba(139,92,246,0.7)",
              "0 0 80px rgba(109,40,217,0.28)",
            ].join(", ");
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.transform = "translateY(0)";
            el.style.boxShadow = [
              "0 0 0 1px rgba(255,255,255,0.09) inset",
              "0 1px 0 rgba(255,255,255,0.16) inset",
              "0 0 22px rgba(139,92,246,0.5)",
              "0 0 60px rgba(109,40,217,0.18)",
            ].join(", ");
          }}
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>

        <p className="text-[11px] text-center font-extrabold text-[#a78bfa]" style={{ color: "rgba(167,139,250,0.4)" }}>
          Access is by invitation only. Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}
