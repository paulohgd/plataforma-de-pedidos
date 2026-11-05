export function validateImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("A imagem passa de 8 MB.");
  }
}

export function cropToDataUrl(image, { sx, sy, size }, { output = 960, type = "image/jpeg", quality = 0.82 } = {}) {
  const sourceSize = Math.max(1, Math.min(Number(size) || 1, image.naturalWidth || image.width, image.naturalHeight || image.height));
  const maxX = Math.max(0, (image.naturalWidth || image.width) - sourceSize);
  const maxY = Math.max(0, (image.naturalHeight || image.height) - sourceSize);
  const x = Math.min(Math.max(0, Number(sx) || 0), maxX);
  const y = Math.min(Math.max(0, Number(sy) || 0), maxY);
  const canvas = document.createElement("canvas");
  canvas.width = output;
  canvas.height = output;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível recortar a imagem.");
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output, output);
  } else {
    context.clearRect(0, 0, output, output);
  }
  context.drawImage(image, x, y, sourceSize, sourceSize, 0, 0, output, output);
  return canvas.toDataURL(type, quality);
}
