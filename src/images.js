export function fileToLogo(file) {
  if (!file || !file.type.startsWith("image/")) {
    return Promise.reject(new Error("Escolha um arquivo de imagem."));
  }
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error("A imagem passa de 8 MB."));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const size = 512;
      const scale = Math.min(size / Math.max(image.width, 1), size / Math.max(image.height, 1));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível ler a imagem."));
        return;
      }
      context.clearRect(0, 0, size, size);
      context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    image.src = url;
  });
}

export function fileToImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    return Promise.reject(new Error("Escolha um arquivo de imagem."));
  }
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error("A imagem passa de 8 MB."));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const max = 960;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível ler a imagem."));
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    image.src = url;
  });
}
