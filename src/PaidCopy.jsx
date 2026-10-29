export function PaidCopy({ title, message }) {
  const paragraphs = String(message || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <>
      <h2>{title}</h2>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph.split(/(\*\*[^*]+?\*\*)/g).map((chunk, chunkIndex) => {
            const bold = chunk.match(/^\*\*([^*]+)\*\*$/);
            if (bold) return <strong key={chunkIndex}>{bold[1]}</strong>;
            return <span key={chunkIndex}>{chunk}</span>;
          })}
        </p>
      ))}
    </>
  );
}
