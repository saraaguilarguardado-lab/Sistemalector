"use client";

import { useEffect, useRef, useState } from "react";
import Tesseract from "tesseract.js";

function hablar(texto: string, opciones: { rate?: number; pitch?: number } = {}) {
  if (typeof window === "undefined") return;

  window.speechSynthesis.cancel();
  const miVoz = new SpeechSynthesisUtterance(texto);
  miVoz.lang = "es-ES";
  miVoz.rate = opciones.rate ?? 0.7;
  miVoz.pitch = opciones.pitch ?? 1;
  window.speechSynthesis.speak(miVoz);
}

function leerTextoPausado(texto: string) {
  if (typeof window === "undefined") return;

  const textoLimpio = texto.replace(/\s+/g, " ").trim();
  if (textoLimpio === "") return;

  const partes = textoLimpio
    .split(/([.!?]+)/)
    .reduce<string[]>((acum, fragmento, indice, arreglo) => {
      if (indice % 2 === 0) {
        const puntuacion = arreglo[indice + 1] || "";
        const frase = (fragmento + puntuacion).trim();
        if (frase) acum.push(frase);
      }
      return acum;
    }, []);

  if (partes.length === 0) {
    hablar(textoLimpio, { rate: 0.7 });
    return;
  }

  window.speechSynthesis.cancel();

  const leerParte = (indice: number) => {
    if (indice >= partes.length) return;

    const mensaje = new SpeechSynthesisUtterance(partes[indice]);
    mensaje.lang = "es-ES";
    mensaje.rate = 0.85;
    mensaje.pitch = 1;
    mensaje.onend = () => {
      setTimeout(() => leerParte(indice + 1), 400);
    };
    window.speechSynthesis.speak(mensaje);
  };

  leerParte(0);
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [estado, setEstado] = useState("Listo para leer una imagen.");
  const [textoDetectado, setTextoDetectado] = useState("");
  const [leyendo, setLeyendo] = useState(false);

  useEffect(() => {
    hablar("Bienvenido. Toca la pantalla en cualquier parte para tomar una foto al texto.");
  }, []);

  const abrirCamara = () => {
    inputRef.current?.click();
  };

  const procesarImagen = async (archivo: File) => {
    setLeyendo(true);
    setEstado("Leyendo la imagen, por favor espera...");
    setTextoDetectado("");
    hablar("Leyendo la imagen, por favor espera.");

    try {
      const resultado = await Tesseract.recognize(archivo, "spa", {
        logger: (mensaje) => console.log(mensaje),
      });

      const text = resultado.data.text;
      const textoLimpio = text.trim();

      if (textoLimpio === "") {
        setEstado("No encontré texto en la imagen.");
        setTextoDetectado("");
        hablar("No pude encontrar ningún texto en la imagen. Inténtalo de nuevo.");
        return;
      }

      setEstado("Texto encontrado.");
      setTextoDetectado(text);
      leerTextoPausado(text);
    } catch (error) {
      setEstado("Error al procesar la imagen.");
      setTextoDetectado("");
      hablar("Hubo un error al leer la imagen.");
      console.error(error);
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top,_#1f2937_0%,_#0f172a_42%,_#020617_100%)] px-4 py-6 text-white sm:px-6 lg:px-8"
      onClick={abrirCamara}
    >
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-white/8 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative p-8 sm:p-10 lg:p-12">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(56,189,248,0.18),transparent_45%,rgba(34,197,94,0.12))]" />
              <div className="relative space-y-8">
                <div className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100">
                  Lector de texto con voz en español
                </div>

                <div className="space-y-4">
                  <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                    Toca la pantalla y toma una foto al texto.
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                    El lector usa OCR para detectar texto en una imagen y luego lo reproduce con voz pausada en español.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      abrirCamara();
                    }}
                    className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                  >
                    Tomar foto
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      hablar("Toca la pantalla en cualquier parte para tomar una foto al texto.");
                    }}
                    className="rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Repetir instrucción
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Estado</p>
                    <p className="mt-2 text-sm leading-6 text-white">{estado}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Idioma de voz</p>
                    <p className="mt-2 text-sm leading-6 text-white">es-ES</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Modo</p>
                    <p className="mt-2 text-sm leading-6 text-white">Cámara o archivo</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 bg-slate-950/50 p-8 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
              <div className="space-y-4">
                <div className="rounded-3xl border border-dashed border-cyan-300/30 bg-white/5 p-6">
                  <p className="text-sm font-medium text-cyan-100">Texto detectado</p>
                  <div className="mt-4 min-h-64 whitespace-pre-wrap rounded-2xl bg-slate-950/60 p-4 text-sm leading-7 text-slate-100">
                    {leyendo && textoDetectado === "" ? (
                      <span className="text-slate-400">Leyendo la imagen, por favor espera...</span>
                    ) : textoDetectado ? (
                      textoDetectado
                    ) : (
                      <span className="text-slate-500">Aquí aparecerá el texto leído de la foto.</span>
                    )}
                  </div>
                </div>

                <p className="text-sm leading-6 text-slate-400">
                  Consejo: usa una imagen con buen contraste y el texto recto para que el reconocimiento sea más preciso.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const archivo = event.target.files?.[0];
          if (archivo) {
            void procesarImagen(archivo);
          }
          event.target.value = "";
        }}
      />
    </main>
  );
}
