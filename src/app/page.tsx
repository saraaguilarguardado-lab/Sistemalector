"use client";

import { useEffect, useRef, useState } from "react";
import Tesseract from "tesseract.js";

const MAX_IMAGE_SIDE = 2200;
const WHITELIST_CARACTERES = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÜÑáéíóúüñ0123456789.,;:¡!¿?()'\"/-\n ";
const MIN_LINE_CONFIDENCE = 60;
const MIN_LETTERS_PER_LINE = 4;

function normalizarTextoOCR(texto: string) {
  return texto
    .split("\n")
    .map((linea) => linea.replace(/[|_~=\[\]{}<>*#+@^\\]/g, " ").trim())
    .filter((linea) => {
      if (!linea) return false;

      const letras = (linea.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
      const signosRuido = (linea.match(/[|_~=\[\]{}<>*#+@^\\]/g) || []).length;
      return letras >= 3 && signosRuido <= 2;
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function contarLetras(texto: string) {
  return (texto.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
}

function extraerTextoConfiable(resultado: Awaited<ReturnType<typeof Tesseract.recognize>>["data"]) {
  const lineas = (resultado.blocks ?? [])
    .flatMap((bloque) => bloque.paragraphs ?? [])
    .flatMap((parrafo) => parrafo.lines ?? [])
    .map((linea) => ({
      texto: normalizarTextoOCR(linea.text),
      confianza: linea.confidence ?? 0,
    }))
    .filter((linea) => linea.texto && linea.confianza >= MIN_LINE_CONFIDENCE)
    .filter((linea) => contarLetras(linea.texto) >= MIN_LETTERS_PER_LINE);

  const texto = normalizarTextoOCR(lineas.map((linea) => linea.texto).join("\n"));

  return {
    texto,
    confianzaPromedio:
      lineas.length > 0
        ? lineas.reduce((suma, linea) => suma + linea.confianza, 0) / lineas.length
        : 0,
    lineasValidas: lineas.length,
  };
}

function calcularUmbralOtsu(histograma: number[], totalPixeles: number) {
  let suma = 0;
  for (let i = 0; i < 256; i += 1) {
    suma += i * histograma[i];
  }

  let sumaFondo = 0;
  let pesoFondo = 0;
  let varianzaMaxima = 0;
  let umbral = 140;

  for (let i = 0; i < 256; i += 1) {
    pesoFondo += histograma[i];
    if (pesoFondo === 0) continue;

    const pesoFrente = totalPixeles - pesoFondo;
    if (pesoFrente === 0) break;

    sumaFondo += i * histograma[i];
    const mediaFondo = sumaFondo / pesoFondo;
    const mediaFrente = (suma - sumaFondo) / pesoFrente;

    const diferencia = mediaFondo - mediaFrente;
    const varianzaEntreClases = pesoFondo * pesoFrente * diferencia * diferencia;

    if (varianzaEntreClases > varianzaMaxima) {
      varianzaMaxima = varianzaEntreClases;
      umbral = i;
    }
  }

  return umbral;
}

async function cargarImagenArchivo(archivo: File) {
  if (typeof window !== "undefined" && "createImageBitmap" in window) {
    try {
      return await createImageBitmap(archivo, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
    } catch {
      // Fallback a <img> cuando createImageBitmap no soporta esta opción.
    }
  }

  const objectUrl = URL.createObjectURL(archivo);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const imagen = new Image();
      imagen.onload = () => resolve(imagen);
      imagen.onerror = () => reject(new Error("No se pudo cargar la imagen."));
      imagen.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepararImagenParaOCR(archivo: File) {
  const imagen = await cargarImagenArchivo(archivo);
  const anchoOriginal = "width" in imagen ? imagen.width : 0;
  const altoOriginal = "height" in imagen ? imagen.height : 0;

  if (anchoOriginal === 0 || altoOriginal === 0) {
    throw new Error("No fue posible leer el tamaño de la imagen.");
  }

  const ladoMayor = Math.max(anchoOriginal, altoOriginal);
  const escalaBase = ladoMayor > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / ladoMayor : 1;
  const escalaMejora = ladoMayor < 1200 ? 1.8 : 1.2;
  const escala = Math.min(2, escalaBase * escalaMejora);

  const ancho = Math.max(1, Math.round(anchoOriginal * escala));
  const alto = Math.max(1, Math.round(altoOriginal * escala));

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;

  const contexto = canvas.getContext("2d", { willReadFrequently: true });
  if (!contexto) {
    throw new Error("No se pudo preparar la imagen para OCR.");
  }

  contexto.drawImage(imagen, 0, 0, ancho, alto);

  if ("close" in imagen && typeof imagen.close === "function") {
    imagen.close();
  }

  const imageData = contexto.getImageData(0, 0, ancho, alto);
  const { data } = imageData;
  const totalPixeles = ancho * alto;
  const histograma = new Array<number>(256).fill(0);
  const grises = new Uint8Array(totalPixeles);

  for (let i = 0, indicePixel = 0; i < data.length; i += 4, indicePixel += 1) {
    const gris = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    grises[indicePixel] = gris;
    histograma[gris] += 1;
  }

  const umbral = calcularUmbralOtsu(histograma, totalPixeles);

  for (let i = 0, indicePixel = 0; i < data.length; i += 4, indicePixel += 1) {
    const valor = grises[indicePixel] > umbral ? 255 : 0;
    data[i] = valor;
    data[i + 1] = valor;
    data[i + 2] = valor;
    data[i + 3] = 255;
  }

  contexto.putImageData(imageData, 0, 0);
  return canvas;
}

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

    let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null;

    try {
      const imagenProcesada = await prepararImagenParaOCR(archivo);

      worker = await Tesseract.createWorker("spa+eng", Tesseract.OEM.LSTM_ONLY, {
        logger: (mensaje) => console.log(mensaje),
      });

      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT_OSD,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_char_whitelist: WHITELIST_CARACTERES,
        tessedit_char_blacklist: "|_~=[]{}<>*#+@^\\",
      });

      const resultado = await worker.recognize(
        imagenProcesada,
        { rotateAuto: true },
        { text: true }
      );

      const textoConfiable = extraerTextoConfiable(resultado.data);
      const textoLimpio = textoConfiable.texto || normalizarTextoOCR(resultado.data.text);

      if (textoConfiable.lineasValidas > 0 && textoConfiable.confianzaPromedio < 72) {
        setEstado("La lectura es demasiado débil. Prueba con otra foto más nítida.");
        setTextoDetectado("");
        hablar("La imagen no tiene suficiente nitidez para una lectura confiable. Intenta con más luz y el texto recto.");
        return;
      }

      if (textoLimpio === "") {
        setEstado("No encontré texto en la imagen.");
        setTextoDetectado("");
        hablar("No pude encontrar ningún texto en la imagen. Inténtalo de nuevo.");
        return;
      }

      setEstado("Texto encontrado.");
      setTextoDetectado(textoLimpio);
      leerTextoPausado(textoLimpio);
    } catch (error) {
      setEstado("Error al procesar la imagen.");
      setTextoDetectado("");
      hablar("Hubo un error al leer la imagen.");
      console.error(error);
    } finally {
      if (worker) {
        await worker.terminate();
      }
      setLeyendo(false);
    }
  };

  return (
    <main
      className="min-h-screen bg-gradient-to-br from-amber-950 via-yellow-950 to-stone-900 px-4 py-6 text-white sm:px-6 lg:px-8"
      onClick={abrirCamara}
    >
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[2rem] border border-white/10 bg-white/8 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="relative p-8 sm:p-10 lg:p-12">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(56,189,248,0.18),transparent_45%,rgba(34,197,94,0.12))]" />
              <div className="relative space-y-8">
                <div tabIndex={2} className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-950 rounded-lg">
                  Lector de texto con voz en español
                </div>

                <div className="space-y-4">
                  <h1 tabIndex={1} className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-950 rounded-lg">
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
